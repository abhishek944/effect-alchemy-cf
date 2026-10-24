import { withCause } from "@starter/diagnostics";
import { bindingScopeFailure } from "./chat-image-binding-types.ts";

export type ImageBindingBody = {
  readonly response: Response;
  readonly done: Promise<void>;
};

/** Own response-body cancellation for the existing provider transport scope. */
export const ownImageBindingBody = async (
  response: Response,
  signal: AbortSignal,
): Promise<ImageBindingBody> => {
  const body = response.body;
  if (body === null) return { response, done: Promise.resolve() };
  const reader = body.getReader();
  let complete: (() => void) | undefined;
  let failComplete: ((error: unknown) => void) | undefined;
  const done = new Promise<void>((resolve, reject) => {
    complete = resolve;
    failComplete = reject;
  });
  // Late body errors may be observed by the caller; never leave an unhandled rejection.
  void done.catch(() => undefined);
  let ended = false;
  let stopping: Promise<unknown> | undefined;
  let reading: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const finish = (failure?: unknown, cleanup?: unknown): void => {
    if (ended) return;
    ended = true;
    signal.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      /* Actual read/cancel has already settled. */
    }
    const primary = failure ?? cleanup;
    const both = failure !== undefined && cleanup !== undefined && cleanup !== failure;
    if (primary === undefined) complete?.();
    else if (!both) failComplete?.(primary);
    else if (primary instanceof Error) failComplete?.(withCause(primary, cleanup));
    else failComplete?.(new AggregateError([primary, cleanup], "Multiple internal failures"));
  };
  const stop = (failure?: unknown): Promise<unknown> => {
    stopping ??= (async () => {
      let cleanup: unknown;
      try {
        await reader.cancel();
      } catch (error) {
        cleanup = error;
      }
      await reading?.catch(() => undefined);
      finish(failure, cleanup);
      return cleanup;
    })();
    return stopping;
  };
  const fail = (error: unknown): void => {
    try {
      controller?.error(error);
    } catch {
      /* Consumer may have already cancelled. */
    }
  };
  const abort = (): void => {
    fail(bindingScopeFailure());
    void stop();
  };
  try {
    const tracked = new ReadableStream<Uint8Array>(
      {
        start(next) {
          controller = next;
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        },
        async pull(next) {
          if (ended || stopping !== undefined) return;
          try {
            reading = reader.read();
            const part = await reading;
            if (stopping !== undefined) return;
            if (signal.aborted) {
              abort();
              return;
            }
            if (part.done) {
              next.close();
              finish();
            } else next.enqueue(part.value);
          } catch (error) {
            fail(error);
            await stop(error);
          }
        },
        cancel: async () => {
          await stop();
        },
      },
      { highWaterMark: 0 },
    );
    return {
      response: new Response(tracked, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
      done,
    };
  } catch (error) {
    const cleanup = await stop();
    const primary = error instanceof Error ? error : withCause(bindingScopeFailure(), error);
    // Construction failure stays owned until actual disposal, never a synthetic response.
    throw withCause(primary, cleanup);
  }
};

/** Late unused binding results are disposed within that same outstanding raw run. */
export const disposeImageBindingResult = async (value: unknown): Promise<unknown> => {
  try {
    if (value instanceof Response) await value.body?.cancel();
    else if (value instanceof ReadableStream) await value.cancel();
    return undefined;
  } catch (error) {
    // Preserve the real disposal failure for the owning binding call.
    return error;
  }
};
