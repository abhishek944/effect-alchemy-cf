import type { ImageContent, UserMessage } from "@earendil-works/pi-ai";
import type { InputOccurrence } from "./chat-image-request-types.ts";
import type { ImageMemoryRequest } from "./chat-image-memory.ts";
import { legacyHydrationByteSize } from "./chat-image-hydration-codec.ts";
import {
  assertHydrationTextBudget,
  measureHydrationContext,
  type HydrationContextSize,
} from "./chat-image-hydration-budget.ts";
import {
  hydrationFailure,
  hydrationSignal,
  type ImageHydrationInput,
} from "./chat-image-hydration-types.ts";

export type HydrationOccurrence = {
  readonly occurrence: InputOccurrence;
  readonly message: UserMessage;
};
export type ImageHydrationPlan = {
  readonly size: HydrationContextSize;
  readonly reservationCharacters: number;
  readonly occurrences: readonly HydrationOccurrence[];
  readonly legacy: readonly { readonly block: ImageContent; readonly byteSize: number }[];
  readonly originals: ImageMemoryRequest["originals"];
};

/** Metadata-only planning. No byte read, decoder, base64 allocation or JSON stringify. */
export const planImageHydration = (input: ImageHydrationInput): ImageHydrationPlan => {
  hydrationSignal(input.signal);
  if (
    input.model.provider !== input.proof.model.provider ||
    input.model.model !== input.proof.model.modelId
  )
    hydrationFailure("model_mismatch");
  const occurrences: HydrationOccurrence[] = [];
  const originals: { kind: "image" | "text"; byteSize: number }[] = [];
  let previous = -1;
  let metadataCharacters = 0;
  for (const occurrence of input.proof.inputs) {
    if (!Number.isSafeInteger(occurrence.requestIndex) || occurrence.requestIndex <= previous)
      hydrationFailure("invalid_context");
    previous = occurrence.requestIndex;
    const message = input.context.messages[occurrence.requestIndex];
    if (
      message?.role !== "user" ||
      !Number.isFinite(message.timestamp) ||
      (Array.isArray(message.content) && message.content.some((block) => block.type !== "text"))
    )
      return hydrationFailure("invalid_context");
    const readable = occurrence.originals.filter((original) => original.kind !== "office");
    if (readable.length === 0) continue;
    occurrences.push({ occurrence: { ...occurrence, originals: readable }, message });
    for (const original of readable) {
      const kind = original.kind;
      if (kind === "office") continue;
      if (kind === "image" && !input.model.imageInput) hydrationFailure("model_image_unsupported");
      originals.push({ kind, byteSize: original.byteSize });
      // Private metadata plus quote headers/boundaries, independent of decoded body size.
      metadataCharacters += 1024 + original.name.length + original.mediaType.length;
    }
  }
  const legacy: { block: ImageContent; byteSize: number }[] = [];
  for (const message of input.context.messages) {
    if (message.role !== "user" && message.role !== "toolResult") continue;
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type !== "image") continue;
      const byteSize = legacyHydrationByteSize(block, input.model);
      legacy.push({ block, byteSize });
      originals.push({ kind: "image", byteSize });
    }
  }
  const size = measureHydrationContext(input.context);
  assertHydrationTextBudget(size, input.model);
  return {
    size,
    reservationCharacters: size.textCharacters + metadataCharacters,
    occurrences,
    legacy,
    originals,
  };
};
