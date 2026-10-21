/** Reserve input headroom instead of treating advertised output capacity as an allocation. */
export const effectiveGenerationOutputTokens = (
  contextWindow: number,
  advertisedOutputTokens: number,
  requestedOutputTokens?: number,
): number => {
  if (
    !Number.isSafeInteger(contextWindow) ||
    contextWindow < 2 ||
    !Number.isSafeInteger(advertisedOutputTokens) ||
    advertisedOutputTokens < 1 ||
    (requestedOutputTokens !== undefined &&
      (!Number.isSafeInteger(requestedOutputTokens) || requestedOutputTokens < 1))
  )
    throw new Error("The selected model has no safe generation output allowance.");
  return Math.min(
    advertisedOutputTokens,
    32_768,
    Math.floor(contextWindow / 2),
    requestedOutputTokens ?? Infinity,
  );
};
