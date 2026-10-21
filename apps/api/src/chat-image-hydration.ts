import type { ImageMemoryLease } from "./chat-image-memory.ts";
import { tryReserveImageMemory } from "./chat-image-memory.ts";
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
  hydrationFailure,
  hydrationSignal,
  type HydratedImageRequest,
  type ImageHydrationInput,
} from "./chat-image-hydration-types.ts";

export {
  ImageHydrationError,
  type ImageHydrationCode,
  type ImageHydrationInput,
  type HydratedImageRequest,
} from "./chat-image-hydration-types.ts";

/**
 * Transient hydration ONLY after parent's bridge.verify and exact acceptance repair.
 * Success transfers lease ownership; release only after REAL provider work settles.
 * No bytes enter native storage, tool results, memos, compaction or checkpoints here.
 */
export const hydrateImageRequest = async (
  input: ImageHydrationInput,
): Promise<HydratedImageRequest> => {
  let lease: ImageMemoryLease | null = null;
  try {
    const plan = planImageHydration(input);
    lease = tryReserveImageMemory({
      purpose: "hydration",
      originals: plan.originals,
      textCharacters: plan.reservationCharacters,
    });
    if (lease === null) return hydrationFailure("memory_unavailable");
    hydrationSignal(input.signal);
    const authorized = await authorizeHydrationOriginals(input, plan, lease);
    for (const legacy of plan.legacy) {
      hydrationSignal(input.signal);
      lease.claim("original", legacy.byteSize);
      // Decoder scratch remains covered alongside the unmodified inline message data.
      await lease.track(async () =>
        checkLegacyHydrationImage(legacy.block, legacy.byteSize, input.model),
      );
    }
    const messages = [...input.context.messages];
    for (const occurrence of authorized) {
      hydrationSignal(input.signal);
      messages[occurrence.occurrence.requestIndex] = await loadHydrationOccurrence(
        input,
        occurrence,
        lease,
      );
    }
    const context = { ...input.context, messages };
    const size = measureHydrationContext(context);
    assertHydrationTextBudget(size, input.model);
    if (size.transportBytes > lease.bytes) hydrationFailure("memory_unavailable");
    // Only after reservation and bounded text checks: SDK may stringify tool metadata.
    assertHydrationTokenBudget(context, input.model);
    hydrationSignal(input.signal);
    return { context, lease };
  } catch (error) {
    lease?.releaseWhenSettled();
    throw hydrationError(error, input.signal);
  }
};
