import type { Context } from "@earendil-works/pi-ai";
import { estimateContextTokens, estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";

/** Include every final message/tool; SDK image estimates do not count base64 as text. */
export const generationInputTokens = (context: Context): number => {
  const transcript = normalizeContext(context);
  const summed = transcript.messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );
  return Math.max(summed, estimateContextTokens(transcript).tokens);
};

/** Fit output to the selected model's remaining context, without application headroom caps. */
export const effectiveGenerationOutputTokens = (
  contextWindow: number,
  advertisedOutputTokens: number,
  context: Context,
  requestedOutputTokens?: number,
): number => {
  const inputTokens = generationInputTokens(context);
  if (
    !Number.isSafeInteger(contextWindow) ||
    contextWindow < 1 ||
    !Number.isSafeInteger(advertisedOutputTokens) ||
    advertisedOutputTokens < 1 ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    inputTokens >= contextWindow ||
    (requestedOutputTokens !== undefined &&
      (!Number.isSafeInteger(requestedOutputTokens) || requestedOutputTokens < 1))
  )
    throw new Error("The selected model has no safe generation output allowance.");
  const maximum = Math.min(advertisedOutputTokens, contextWindow - inputTokens);
  return requestedOutputTokens === undefined ? maximum : Math.min(maximum, requestedOutputTokens);
};
