import type { Context } from "@earendil-works/pi-ai";
import { checkLegacyHydrationImage } from "./chat-image-hydration-codec.ts";
import {
  assertHydrationTextBudget,
  assertHydrationTokenBudget,
  measureHydrationContext,
} from "./chat-image-hydration-budget.ts";
import { planImageHydration } from "./chat-image-hydration-plan.ts";
import {
  authorizeHydrationOriginals,
  loadHydrationOccurrence,
} from "./chat-image-hydration-originals.ts";
import {
  hydrationError,
  hydrationSignal,
  type ImageHydrationInput,
} from "./chat-image-hydration-types.ts";

export {
  ImageHydrationError,
  type ImageHydrationCode,
  type ImageHydrationInput,
} from "./chat-image-hydration-types.ts";

/** Request-only bytes never enter native history, checkpoints or compaction. */
export const hydrateImageRequest = async (input: ImageHydrationInput): Promise<Context> => {
  try {
    const plan = planImageHydration(input);
    hydrationSignal(input.signal);
    const authorized = await authorizeHydrationOriginals(input, plan);
    for (const legacy of plan.legacy) {
      hydrationSignal(input.signal);
      checkLegacyHydrationImage(legacy.block, legacy.byteSize, input.model);
    }
    const messages = [...input.context.messages];
    for (const occurrence of authorized) {
      hydrationSignal(input.signal);
      messages[occurrence.occurrence.requestIndex] = await loadHydrationOccurrence(
        input,
        occurrence,
      );
    }
    const context = { ...input.context, messages };
    assertHydrationTextBudget(measureHydrationContext(context), input.model);
    assertHydrationTokenBudget(context, input.model);
    hydrationSignal(input.signal);
    return context;
  } catch (error) {
    throw hydrationError(error, input.signal);
  }
};
