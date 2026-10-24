import type { ImageContent, UserMessage } from "@earendil-works/pi-ai";
import type { InputOccurrence } from "./chat-image-request-types.ts";
import { legacyHydrationByteSize } from "./chat-image-hydration-codec.ts";
import {
  assertHydrationTextBudget,
  measureHydrationContext,
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
  readonly occurrences: readonly HydrationOccurrence[];
  readonly legacy: readonly { readonly block: ImageContent; readonly byteSize: number }[];
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
  let previous = -1;
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
    }
  }
  const size = measureHydrationContext(input.context);
  assertHydrationTextBudget(size, input.model);
  return { occurrences, legacy };
};
