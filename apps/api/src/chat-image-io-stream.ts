import { MAX_IMAGE_BYTES } from "./chat-attachment-schema.ts";
import { checkImageIOSignal, ImageIOError } from "./chat-image-io-error.ts";

/** Structural boundary shared by Workers R2 and Fetch streams; chunks stay unknown. */
export type ImageByteStream = {
  getReader(): {
    read(): Promise<{ readonly done: boolean; readonly value?: unknown }>;
    cancel(): Promise<void>;
    releaseLock(): void;
  };
  cancel(): Promise<void>;
};

/** Await disposal so late/cancelled original reads still close their body. */
export const disposeImageStream = async (stream: ImageByteStream): Promise<void> => {
  try {
    await stream.cancel();
  } catch {
    // Disposal failure must not echo a foreign stream's error or mask integrity failure.
  }
};

/**
 * Run inside runImageIO. Preallocates exactly the preflighted length, retains no
 * chunk list, rejects short/oversized/non-byte bodies and awaits read/cancel work.
 */
export const readImageStream = async (
  stream: ImageByteStream,
  byteSize: number,
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_IMAGE_BYTES)
    throw new ImageIOError("stream_limit", "The original byte length is invalid.");
  const reader = stream.getReader();
  let cancellation: Promise<void> | undefined;
  const cancel = (): Promise<void> => {
    cancellation ??= Promise.resolve()
      .then(() => reader.cancel())
      .catch(() => undefined);
    return cancellation;
  };
  const abort = (): void => {
    void cancel();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    checkImageIOSignal(signal);
    const bytes = new Uint8Array(byteSize);
    let used = 0;
    for (;;) {
      const part = await reader.read();
      checkImageIOSignal(signal);
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || part.value.byteLength > byteSize - used)
        throw new ImageIOError(
          "stream_limit",
          "The original body exceeds its declared byte length.",
        );
      bytes.set(part.value, used);
      used += part.value.byteLength;
    }
    if (used !== byteSize)
      throw new ImageIOError("stream_limit", "The original body is incomplete.");
    return bytes;
  } catch (error) {
    await cancel();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    await cancellation;
    reader.releaseLock();
  }
};
