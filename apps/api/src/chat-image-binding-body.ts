import { bindingScopeFailure } from "./chat-image-binding-types.ts";

export type ImageBindingBody = {
  readonly response: Response;
  readonly done: Promise<void>;
};

/** Called INSIDE the existing tracked raw run; never starts new work on a closing lease. */
export const ownImageBindingBody = async (
  response: Response,
  signal: AbortSignal,
): Promise<ImageBindingBody> => {
  const body = response.body;
  if (body === null) return { response, done: Promise.resolve() };
  const reader = body.getReader();
  let complete: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let ended = false;
  let stopping: Promise<void> | undefined;
  let reading: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const finish = (): void => {
    if (ended) return;
    ended = true;
    signal.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      /* Actual read/cancel has already settled. */
    }
    complete?.();
  };
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      try {
        await reader.cancel();
      } catch {
        /* Still join any actual pending read. */
      }
      await reading?.catch(() => undefined);
      finish();
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
            await stop();
          }
        },
        cancel: () => stop(),
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
  } catch {
    // Construction failure stays owned until actual disposal, never a synthetic response.
    await stop();
    throw bindingScopeFailure();
  }
};

/** Late unused binding results are disposed within that same outstanding raw run. */
export const disposeImageBindingResult = async (value: unknown): Promise<void> => {
  try {
    if (value instanceof Response) await value.body?.cancel();
    else if (value instanceof ReadableStream) await value.cancel();
  } catch {
    /* Awaited cancellation is finished; never echo a foreign body. */
  }
};
