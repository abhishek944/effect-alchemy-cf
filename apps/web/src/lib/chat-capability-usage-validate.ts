/**
 * Manual validators for the chat usage projection. Completeness, provenance,
 * reasoning-as-output-subset and the reported-input identity are enforced so a
 * partial or unknown total can never be read as a complete bill.
 */
import type {
  ChatAttemptUsage,
  ChatContextUsage,
  ChatTokenCounters,
  ChatUsage,
  ChatUsageAmount,
  ChatUsageCompleteness,
  ChatUsageProvenance,
} from "@/lib/chat-capability-usage-types";
import { ATTEMPT_CATEGORIES, MAX_USAGE_ATTEMPTS } from "@/lib/chat-capability-usage-types";
import { parseChatSpeechUsageTotals } from "@/lib/chat-capability-speech-usage-validate";
import { isChatEffort, isChatModelId, listed } from "@/lib/chat-capability-validate";
import { isRecord, isUuid } from "@/lib/chat-validate-base";

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isProvenance = (value: unknown): value is ChatUsageProvenance =>
  value === "reported" || value === "estimated" || value === "unknown";
const isCompleteness = (value: unknown): value is ChatUsageCompleteness =>
  value === "complete" || value === "partial" || value === "unknown";

/** Nullable counter: null is unknown, an absent or invalid field is rejected. */
const counterOf = (value: unknown): number | null | undefined =>
  value === null ? null : isCount(value) ? value : undefined;

export const parseChatTokenCounters = (value: unknown): ChatTokenCounters | null => {
  if (!isRecord(value)) return null;
  const inputUncached = counterOf(value.inputUncached);
  const inputReported = counterOf(value.inputReported);
  const output = counterOf(value.output);
  const cacheRead = counterOf(value.cacheRead);
  const cacheWrite = counterOf(value.cacheWrite);
  const reasoning = counterOf(value.reasoning);
  if (
    inputUncached === undefined ||
    inputReported === undefined ||
    output === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined ||
    reasoning === undefined
  )
    return null;
  if (reasoning !== null && output !== null && reasoning > output) return null;
  if (
    inputReported !== null &&
    inputUncached !== null &&
    cacheRead !== null &&
    cacheWrite !== null &&
    inputReported !== inputUncached + cacheRead + cacheWrite
  )
    return null;
  return { inputUncached, inputReported, output, cacheRead, cacheWrite, reasoning };
};

export function parseChatUsageAmount(value: unknown): ChatUsageAmount | null {
  if (!isRecord(value)) return null;
  if (!isProvenance(value.provenance) || !isCompleteness(value.completeness)) return null;
  const tokens = parseChatTokenCounters(value.tokens);
  if (!tokens) return null;
  if (value.estimatedCostUsd !== null && !isAmount(value.estimatedCostUsd)) return null;
  const estimatedCostUsd = value.estimatedCostUsd;
  const empty =
    tokens.inputUncached === null &&
    tokens.inputReported === null &&
    tokens.output === null &&
    tokens.cacheRead === null &&
    tokens.cacheWrite === null &&
    tokens.reasoning === null;
  if (value.provenance === "unknown") {
    if (!empty || estimatedCostUsd !== null || value.completeness !== "unknown") return null;
  } else if (value.completeness === "unknown") {
    return null;
  } else if (value.completeness === "complete") {
    if (
      tokens.inputUncached === null ||
      tokens.inputReported === null ||
      tokens.output === null ||
      estimatedCostUsd === null
    )
      return null;
  } else if (empty && estimatedCostUsd === null) {
    return null;
  }
  return {
    provenance: value.provenance,
    completeness: value.completeness,
    tokens,
    estimatedCostUsd,
  };
}

export function parseChatContextUsage(value: unknown): ChatContextUsage | null {
  if (!isRecord(value)) return null;
  if (value.provenance !== "estimated" && value.provenance !== "unknown") return null;
  if (value.model !== null && !isChatModelId(value.model)) return null;
  if (value.estimatedTokens !== null && !isCount(value.estimatedTokens)) return null;
  if (value.contextWindow !== null && (!isCount(value.contextWindow) || value.contextWindow === 0))
    return null;
  const estimated = value.provenance === "estimated";
  if (
    estimated &&
    (value.model === null || value.estimatedTokens === null || value.contextWindow === null)
  )
    return null;
  if (
    !estimated &&
    (value.model !== null || value.estimatedTokens !== null || value.contextWindow !== null)
  )
    return null;
  return {
    provenance: value.provenance,
    model: value.model,
    estimatedTokens: value.estimatedTokens,
    contextWindow: value.contextWindow,
  };
}

export function parseChatAttemptUsage(value: unknown): ChatAttemptUsage | null {
  if (!isRecord(value) || !isUuid(value.attemptId)) return null;
  if (!listed(ATTEMPT_CATEGORIES, value.category)) return null;
  if (!isChatModelId(value.model) || !isChatEffort(value.effort)) return null;
  const amount = parseChatUsageAmount(value.amount);
  if (!amount) return null;
  return {
    attemptId: value.attemptId,
    category: value.category,
    model: value.model,
    effort: value.effort,
    amount,
  };
}

export function parseChatUsage(value: unknown): ChatUsage | null {
  if (!isRecord(value) || !isCompleteness(value.completeness)) return null;
  const amount = parseChatUsageAmount(value.amount);
  const context = parseChatContextUsage(value.context);
  const speech = parseChatSpeechUsageTotals(value.speech);
  if (!amount || !context || !speech) return null;
  if (!Array.isArray(value.attempts) || value.attempts.length > MAX_USAGE_ATTEMPTS) return null;
  const attempts: ChatAttemptUsage[] = [];
  for (const item of value.attempts) {
    const attempt = parseChatAttemptUsage(item);
    if (!attempt) return null;
    attempts.push(attempt);
  }
  if (value.completeness === "complete") {
    if (amount.completeness !== "complete" || speech.completeness !== "complete") return null;
  } else if (value.completeness === "unknown") {
    if (amount.completeness !== "unknown" || speech.completeness !== "unknown") return null;
  }
  return { completeness: value.completeness, amount, context, attempts, speech };
}
