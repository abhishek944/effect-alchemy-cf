import type { ImageHost } from "@abhishek944/pi-image-gen/core";
import { MAX_IMAGE_BYTES } from "./chat-attachment-schema.ts";

/** Actual encoded response-body bound for the existing image-file ceiling. */
export const NATIVE_IMAGE_RESPONSE_BYTES = 4 * Math.ceil(MAX_IMAGE_BYTES / 3) + 64 * 1024;
export const NATIVE_IMAGE_TIMEOUT_MS = 120_000;

export function nativeImageLimits(
  referenceBytes: number,
): NonNullable<ImageHost<unknown>["limits"]> {
  if (!Number.isSafeInteger(referenceBytes) || referenceBytes < 0)
    throw new Error("The image reference byte size is invalid.");
  return {
    imageBytes: MAX_IMAGE_BYTES,
    referenceBytes: Math.max(1, referenceBytes),
    responseBytes: NATIVE_IMAGE_RESPONSE_BYTES,
  };
}
