import type { ImageHost } from "@abhishek944/pi-image-gen/core";

/**
 * Workers execution policy, not the 10 MiB accepted-file limit or provider limit.
 * With the borrowed-RPC storage profile, this fits the conservative 96 MiB image
 * pool for an ordinary generation and a typical 1 MiB edit. Larger references
 * fail before dispatch; a larger provider output can fail after paid contact.
 * Originals are never resized. Live heap behavior remains separately unverified.
 */
export const NATIVE_IMAGE_EXECUTION_BYTES = 4 * 1024 * 1024;
export const NATIVE_IMAGE_EDIT_BYTES = 3 * 1024 * 1024;
export const NATIVE_IMAGE_RESPONSE_BYTES =
  4 * Math.ceil(NATIVE_IMAGE_EXECUTION_BYTES / 3) + 64 * 1024;
export const NATIVE_IMAGE_TIMEOUT_MS = 120_000;

export function nativeImageLimits(
  referenceBytes: number,
): NonNullable<ImageHost<unknown>["limits"]> {
  if (!Number.isSafeInteger(referenceBytes) || referenceBytes < 0)
    throw new Error("The image reference byte budget is invalid.");
  // The owner separately reserves ingest/hash capacity before dispatch. A
  // smaller edit envelope leaves room for original encoding in the same isolate.
  const imageBytes = referenceBytes > 0 ? NATIVE_IMAGE_EDIT_BYTES : NATIVE_IMAGE_EXECUTION_BYTES;
  return {
    imageBytes,
    referenceBytes: Math.max(1, referenceBytes),
    responseBytes: 4 * Math.ceil(imageBytes / 3) + 64 * 1024,
  };
}
