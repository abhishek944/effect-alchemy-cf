import { officeModelInput } from "./chat-office-model-input.ts";
import type { Context } from "@earendil-works/pi-ai";
import { checkLegacyHydrationImage } from "./chat-image-hydration-codec.ts";
import { assertHydrationTokenBudget } from "./chat-image-hydration-budget.ts";
import { planImageHydration } from "./chat-image-hydration-plan.ts";
import {
  authorizeHydrationOriginals,
  loadHydrationOccurrence,
} from "./chat-image-hydration-originals.ts";
import {
  hydrationError,
  hydrationFailure,
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
    for (const occurrence of input.proof.inputs) {
      const message = messages[occurrence.requestIndex];
      if (message?.role !== "user") return hydrationFailure("invalid_context");
      messages[occurrence.requestIndex] = officeModelInput(message, occurrence);
    }
    const context = { ...input.context, messages };
    assertHydrationTokenBudget(context, input.model);
    hydrationSignal(input.signal);
    return context;
  } catch (error) {
    throw hydrationError(error, input.signal);
  }
};
