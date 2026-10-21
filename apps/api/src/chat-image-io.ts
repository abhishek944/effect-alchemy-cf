import type { ImageMemoryLease } from "./chat-image-memory.ts";
import { checkImageIOSignal, imageIOCancelled, safeImageIOError } from "./chat-image-io-error.ts";

export type ImageIOOperation<T> = {
  readonly lease: ImageMemoryLease;
  readonly signal: AbortSignal | undefined;
  /** Must await REAL underlying work, including stream cleanup and validation. */
  readonly run: () => Promise<T>;
  /** Dispose a resource returned after logical cancellation, while still tracked. */
  readonly disposeLate?: (value: T) => Promise<void>;
};

/**
 * Cancellation settles the caller promptly but not the underlying lease work.
 * Do not pass an operation that races AbortSignal internally and abandons its I/O.
 * For a headers-only Response, run must also own body consumption/disposal: merely
 * tracking AI.run/fetch until headers arrive does NOT track its response body.
 */
export const runImageIO = <T>(operation: ImageIOOperation<T>): Promise<T> => {
  if (operation.signal?.aborted) return Promise.reject(imageIOCancelled());
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const signal = operation.signal;
    const detach = (): void => signal?.removeEventListener("abort", abort);
    const fail = (error: unknown): void => {
      if (finished) return;
      finished = true;
      detach();
      reject(safeImageIOError(error));
    };
    const abort = (): void => fail(imageIOCancelled());
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    if (finished) return;
    try {
      const underlying = operation.lease.track(async () => {
        try {
          checkImageIOSignal(signal);
          const value = await operation.run();
          if (finished || signal?.aborted) {
            await operation.disposeLate?.(value);
            fail(imageIOCancelled());
            return;
          }
          finished = true;
          detach();
          resolve(value);
        } catch (error) {
          fail(signal?.aborted ? imageIOCancelled() : error);
        } finally {
          detach();
        }
      });
      void underlying.catch(fail);
    } catch (error) {
      fail(error);
    }
  });
};
