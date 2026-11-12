import type { Model } from "@earendil-works/pi-ai";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";

/** Pinned native protocol/capability enrichment, not an availability list or transport. */
export const gatewayModelMetadata: readonly Model<"openai-responses" | "anthropic-messages">[] = [
  ...Object.values(OPENAI_MODELS).map((model) => ({
    ...model,
    id: `openai/${model.id}`,
    provider: "openrouter",
  })),
  ...Object.values(ANTHROPIC_MODELS).map((model) => {
    const compat = { ...model.compat };
    // A frozen gateway selection must never ask the native serializer for another model.
    delete compat.allowedFallbackModels;
    return { ...model, compat, id: `anthropic/${model.id}`, provider: "openrouter" };
  }),
];
