import type { Context } from "@earendil-works/pi-ai";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import { generationInputTokens } from "./chat-generation-output-budget.ts";
import { hydrationFailure } from "./chat-image-hydration-types.ts";

/** Check selected-model input capacity; the final Models guard derives remaining output room. */
export const assertHydrationTokenBudget = (context: Context, model: ChatCatalogModel): void => {
  const tokens = generationInputTokens(context);
  if (!Number.isSafeInteger(tokens) || tokens < 0 || tokens >= model.contextWindow)
    hydrationFailure("context_budget");
};
