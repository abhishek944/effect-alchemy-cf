/** Safe host I/O failures. Never include private keys, URLs or foreign error bodies. */
import { withCause } from "@starter/diagnostics";

export type ImageIOCode =
  | "cancelled"
  | "invalid_metadata"
  | "original_unavailable"
  | "original_integrity"
  | "stream_limit"
  | "output_url_refused"
  | "io_failed";

export class ImageIOError extends Error {
  readonly code: ImageIOCode;

  constructor(code: ImageIOCode, message: string) {
    super(message);
    this.name = "ImageIOError";
    this.code = code;
  }
}

export const imageIOCancelled = (): ImageIOError =>
  new ImageIOError("cancelled", "Image I/O was cancelled.");

export const checkImageIOSignal = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw imageIOCancelled();
};

export const safeImageIOError = (error: unknown): ImageIOError =>
  error instanceof ImageIOError
    ? error
    : withCause(new ImageIOError("io_failed", "Private image I/O could not be completed."), error);
