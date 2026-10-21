import type { ImageMemoryLease } from "./chat-image-memory.ts";
import {
  checkImageIOSignal,
  imageIOCancelled,
  ImageIOError,
  safeImageIOError,
} from "./chat-image-io-error.ts";

export type ImageResponseBodyInput = {
  readonly response: Response;
  readonly lease: ImageMemoryLease;
  readonly signal?: AbortSignal;
};

/**
 * Keep a catalog Response body lease-tracked AFTER transport headers resolve.
 * Later gateway adapter must call this inside its tracked real transport work.
 * No fetch/AI dispatch, provider serialization or JSON parsing occurs here.
 */
export const retainImageResponseBody = async (input: ImageResponseBodyInput): Promise<Response> => {
  const { response, lease, signal } = input;
  const body = response.body;
  const limit = lease.responseBytes;
  try {
    checkImageIOSignal(signal);
    if (body === null) return response;
    if (response.bodyUsed || body.locked || limit < 1)
      throw new ImageIOError("stream_limit", "The image response body cannot be admitted.");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^[0-9]{1,16}$/.test(length) || Number(length) > limit))
      throw new ImageIOError("stream_limit", "The image response exceeds its reserved byte limit.");
    lease.claim("response", limit);
  } catch (error) {
    try {
      await body?.cancel();
    } catch {
      // Await the real cancellation, without leaking a foreign response error.
    }
    throw safeImageIOError(error);
  }
  // The null-body branch above returned; retain a local narrowed body reference.
  if (body === null) return response;
  const reader = body.getReader();
  let complete: (() => void) | undefined;
  const completion = new Promise<void>((resolve) => {
    complete = resolve;
  });
  try {
    void lease.track(() => completion).catch(() => undefined);
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the safe admission error after real cancellation settles.
    } finally {
      reader.releaseLock();
    }
    throw safeImageIOError(error);
  }
  let ended = false;
  let stopping: Promise<void> | undefined;
  let reading: Promise<{ readonly done: boolean; readonly value?: unknown }> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const finish = (): void => {
    if (ended) return;
    ended = true;
    signal?.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      // All actual reads/cancellation have settled; lock cleanup is observational.
    }
    complete?.();
  };
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      try {
        await reader.cancel();
      } catch {
        // Still await any outstanding real read before releasing its allocation.
      }
      await reading?.catch(() => undefined);
      finish();
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
              throw new ImageIOError(
                "stream_limit",
                "The image response exceeds its reserved byte limit.",
              );
            used += part.value.byteLength;
            next.enqueue(part.value);
          } catch (error) {
            next.error(safeImageIOError(error));
            await stop();
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
    await stop();
    throw safeImageIOError(error);
  }
};
