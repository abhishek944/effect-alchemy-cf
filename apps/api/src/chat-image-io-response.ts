import { reportFailure, withCause } from "@starter/diagnostics";
import type { ImageIOTracker } from "./chat-image-io.ts";
import {
  checkImageIOSignal,
  imageIOCancelled,
  ImageIOError,
  safeImageIOError,
} from "./chat-image-io-error.ts";

export type ImageResponseBodyInput = {
  readonly response: Response;
  readonly track: ImageIOTracker;
  readonly responseBytes: number;
  readonly operationId?: string;
  readonly signal?: AbortSignal;
};

/**
 * Observe actual response-body completion AFTER transport headers resolve.
 * Later gateway adapter must call this inside its tracked real transport work.
 * No fetch/AI dispatch, provider serialization or JSON parsing occurs here.
 */
export const retainImageResponseBody = async (input: ImageResponseBodyInput): Promise<Response> => {
  const { response, track, signal } = input;
  const body = response.body;
  const limit = input.responseBytes;
  try {
    checkImageIOSignal(signal);
    if (body === null) return response;
    if (response.bodyUsed || body.locked || limit < 1)
      throw new ImageIOError("stream_limit", "The image response body cannot be admitted.");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^[0-9]{1,16}$/.test(length) || Number(length) > limit))
      throw new ImageIOError("stream_limit", "The image response exceeds its byte limit.");
  } catch (error) {
    let cleanup: unknown;
    try {
      await body?.cancel();
    } catch (cause) {
      // Preserve the real cancellation failure; never leak a foreign response error.
      cleanup = cause;
    }
    throw withCause(safeImageIOError(error), cleanup);
  }
  // The null-body branch above returned; retain a local narrowed body reference.
  if (body === null) return response;
  const reader = body.getReader();
  let complete: (() => void) | undefined;
  let failComplete: ((error: unknown) => void) | undefined;
  const completion = new Promise<void>((resolve, reject) => {
    complete = resolve;
    failComplete = reject;
  });
  try {
    void track(() => completion).catch(() => undefined);
  } catch (error) {
    let cleanup: unknown;
    try {
      await reader.cancel();
    } catch (cause) {
      cleanup = cause;
    } finally {
      try {
        reader.releaseLock();
      } catch (cause) {
        cleanup ??= cause;
      }
    }
    throw withCause(safeImageIOError(error), cleanup);
  }
  let ended = false;
  let stopping: Promise<void> | undefined;
  let reading: Promise<{ readonly done: boolean; readonly value?: unknown }> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const finish = (failure?: unknown, cleanup?: unknown): void => {
    if (ended) return;
    ended = true;
    signal?.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      // All actual reads/cancellation have settled; lock cleanup is observational.
    }
    const primary = failure ?? cleanup;
    if (primary === undefined) complete?.();
    else failComplete?.(withCause(safeImageIOError(primary), cleanup));
  };
  const stop = (failure?: unknown): Promise<void> => {
    stopping ??= (async () => {
      let cleanup: unknown;
      try {
        await reader.cancel();
      } catch (error) {
        // Keep the real cancel failure in the completion Exit.
        cleanup = error;
      }
      await reading?.catch(() => undefined);
      finish(failure, cleanup);
      if (failure === undefined && cleanup !== undefined)
        reportFailure(cleanup, {
          component: "chat-image",
          operation: "response-body-cancel",
          event: "application.cleanup",
          operationId: input.operationId,
        });
    })();
    return stopping;
  };
  const abort = (): void => {
    controller?.error(imageIOCancelled());
    void stop();
  };
  let used = 0;
  try {
    const trackedBody = new ReadableStream<Uint8Array>(
      {
        start(next) {
          controller = next;
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
        },
        async pull(next) {
          if (ended || stopping !== undefined) return;
          try {
            reading = reader.read();
            const part = await reading;
            if (stopping !== undefined) return;
            checkImageIOSignal(signal);
            if (part.done) {
              next.close();
              finish();
              return;
            }
            if (!(part.value instanceof Uint8Array) || part.value.byteLength > limit - used)
              throw new ImageIOError("stream_limit", "The image response exceeds its byte limit.");
            used += part.value.byteLength;
            next.enqueue(part.value);
          } catch (error) {
            const failure = safeImageIOError(error);
            next.error(failure);
            await stop(failure);
          }
        },
        cancel: () => stop(),
      },
      // Do not prefetch an extra chunk before the package asks for it.
      { highWaterMark: 0 },
    );
    return new Response(trackedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    await stop(error);
    throw safeImageIOError(error);
  }
};
