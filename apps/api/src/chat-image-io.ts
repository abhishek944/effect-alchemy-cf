import { withCause } from "@starter/diagnostics";
import { checkImageIOSignal, imageIOCancelled, safeImageIOError } from "./chat-image-io-error.ts";

export type ImageIOTracker = <T>(work: () => Promise<T>) => Promise<T>;

export type ImageIOOperation<T> = {
  /** Optional observation of actual work for durable host settlement, never admission. */
  readonly track?: ImageIOTracker;
  readonly signal: AbortSignal | undefined;
  /** Must await REAL underlying work, including stream cleanup and validation. */
  readonly run: () => Promise<T>;
  /** Dispose a resource returned after logical cancellation, while still tracked. */
  readonly disposeLate?: (value: T) => Promise<void>;
  /** Observe a real late failure after the logical caller already settled; called once. */
  readonly onLateFailure?: (error: unknown) => void;
};

/**
 * Cancellation settles the caller promptly; actual work still owns late cleanup.
 * Do not pass an operation that races AbortSignal internally and abandons its I/O.
 * For a headers-only Response, run must also own body consumption/disposal: merely
 * tracking AI.run/fetch until headers arrive does NOT track its response body.
 */
export const runImageIO = <T>(operation: ImageIOOperation<T>): Promise<T> => {
  if (operation.signal?.aborted) return Promise.reject(imageIOCancelled());
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    let lateReported = false;
    const signal = operation.signal;
    const detach = (): void => signal?.removeEventListener("abort", abort);
    const late = (error: unknown): void => {
      if (lateReported) return;
      lateReported = true;
      operation.onLateFailure?.(error);
    };
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
      const execute = async (): Promise<void> => {
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
          if (finished) late(error);
          else fail(signal?.aborted ? withCause(imageIOCancelled(), error) : error);
        } finally {
          detach();
        }
      };
      const underlying = operation.track === undefined ? execute() : operation.track(execute);
      void underlying.catch((error) => {
        if (finished) late(error);
        else fail(error);
      });
    } catch (error) {
      fail(error);
    }
  });
};
