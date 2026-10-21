import type * as cf from "@cloudflare/workers-types";
import type { Context } from "@earendil-works/pi-ai";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import type { ImageMemoryLease } from "./chat-image-memory.ts";
import type { GenerationRequestProof } from "./chat-image-request-types.ts";
import { ImageIOError } from "./chat-image-io-error.ts";

export type ImageHydrationInput = {
  /** Already taken/verified by the mandatory parent Models gate. */
  readonly proof: GenerationRequestProof;
  /** Exact proof positions; do not collapse/reorder messages before this helper. */
  readonly context: Context;
  readonly model: ChatCatalogModel;
  /** Authenticated owner's actual catalog stub; its id supplies the private object scope. */
  readonly catalog?: cf.DurableObjectStub;
  readonly bucket?: cf.R2Bucket;
  readonly signal?: AbortSignal;
};
export type HydratedImageRequest = {
  readonly context: Context;
  /** Caller keeps this through actual provider transport/stream/body/serialization settlement. */
  readonly lease: ImageMemoryLease;
};

const messages = {
  invalid_context: "Image request positions or compact content could not be verified.",
  metadata_mismatch: "A saved original no longer matches its immutable reference.",
  original_unavailable: "A saved original is unavailable; its identity is unchanged.",
  original_integrity: "A saved original could not be verified.",
  model_mismatch: "The selected chat model does not match this verified request.",
  model_image_unsupported: "This model cannot read the images in this request.",
  model_image_limits: "An original exceeds this model's image limits; nothing was resized.",
  quoted_text_too_large: "Quoted files exceed the supported text limit for this message.",
  text_budget: "The request's text and guidance exceed the supported request budget.",
  context_budget: "The estimated image and text context exceeds this model's input budget.",
  memory_unavailable: "This request cannot fit the available transient image memory.",
  cancelled: "This request was stopped before original reading completed.",
  read_failed: "Private originals could not be read for this request.",
} as const;
export type ImageHydrationCode = keyof typeof messages;

/** Code and message are fixed; never retain a foreign error body, URL or private key. */
export class ImageHydrationError extends Error {
  readonly code: ImageHydrationCode;
  constructor(code: ImageHydrationCode) {
    super(messages[code]);
    this.code = code;
    this.name = "ImageHydrationError";
  }
}
export const hydrationFailure = (code: ImageHydrationCode): never => {
  throw new ImageHydrationError(code);
};
export const hydrationSignal = (signal?: AbortSignal): void => {
  if (signal?.aborted) hydrationFailure("cancelled");
};
export const hydrationError = (error: unknown, signal?: AbortSignal): ImageHydrationError => {
  if (signal?.aborted) return new ImageHydrationError("cancelled");
  if (error instanceof ImageHydrationError) return error;
  if (error instanceof ImageIOError) {
    if (
      error.code === "original_unavailable" ||
      error.code === "original_integrity" ||
      error.code === "cancelled"
    )
      return new ImageHydrationError(error.code);
    if (error.code === "invalid_metadata") return new ImageHydrationError("metadata_mismatch");
    if (error.code === "invalid_memory_estimate" || error.code === "lease_capacity")
      return new ImageHydrationError("memory_unavailable");
  }
  return new ImageHydrationError("read_failed");
};
