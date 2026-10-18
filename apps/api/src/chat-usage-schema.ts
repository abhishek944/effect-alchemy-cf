/** Nullable reported counters and estimated prices; cache input is never counted twice. */
import { Schema } from "effect";
import { ChatEffort, ChatModelId, DomainUuid } from "./chat-capabilities.ts";

export const USAGE_PROVENANCE = ["reported", "estimated", "unknown"] as const;
export const UsageProvenance = Schema.Literals(USAGE_PROVENANCE);
export type UsageProvenance = typeof UsageProvenance.Type;
export const USAGE_COMPLETENESS = ["complete", "partial", "unknown"] as const;
export const UsageCompleteness = Schema.Literals(USAGE_COMPLETENESS);
export type UsageCompleteness = typeof UsageCompleteness.Type;
const Counter = Schema.NullOr(
  Schema.Number.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0)),
);
/** Nullable finite nonnegative number for a quantity or a catalog-price estimate. */
const Amount = Schema.NullOr(
  Schema.Number.check(Schema.makeFilter((value) => Number.isFinite(value) && value >= 0)),
);

export const TokenCounters = Schema.Struct({
  inputUncached: Counter,
  inputReported: Counter,
  output: Counter,
  cacheRead: Counter,
  cacheWrite: Counter,
  /** Subset of `output`; never added to it. */
  reasoning: Counter,
}).check(
  Schema.makeFilter((counters) => {
    if (
      counters.reasoning !== null &&
      counters.output !== null &&
      counters.reasoning > counters.output
    )
      return false;
    if (
      counters.inputReported === null ||
      counters.inputUncached === null ||
      counters.cacheRead === null ||
      counters.cacheWrite === null
    )
      return true;
    return (
      counters.inputReported === counters.inputUncached + counters.cacheRead + counters.cacheWrite
    );
  }),
);
export type TokenCounters = typeof TokenCounters.Type;
const noCounters = (counters: TokenCounters): boolean =>
  counters.inputUncached === null &&
  counters.inputReported === null &&
  counters.output === null &&
  counters.cacheRead === null &&
  counters.cacheWrite === null &&
  counters.reasoning === null;

export const UsageAmount = Schema.Struct({
  provenance: UsageProvenance,
  completeness: UsageCompleteness,
  tokens: TokenCounters,
  estimatedCostUsd: Amount,
}).check(
  Schema.makeFilter((amount) => {
    if (amount.provenance === "unknown")
      return (
        noCounters(amount.tokens) &&
        amount.estimatedCostUsd === null &&
        amount.completeness === "unknown"
      );
    if (amount.completeness === "unknown") return false;
    if (amount.completeness === "complete")
      return (
        amount.tokens.inputUncached !== null &&
        amount.tokens.inputReported !== null &&
        amount.tokens.output !== null &&
        amount.estimatedCostUsd !== null
      );
    return !noCounters(amount.tokens) || amount.estimatedCostUsd !== null;
  }),
);
export type UsageAmount = typeof UsageAmount.Type;

export const ContextUsage = Schema.Struct({
  provenance: Schema.Literals(["estimated", "unknown"]),
  model: Schema.NullOr(ChatModelId),
  /** Estimated authoritative server context, not the bounded browser transcript. */
  estimatedTokens: Counter,
  contextWindow: Counter,
}).check(
  Schema.makeFilter((context) =>
    context.provenance === "unknown"
      ? context.model === null && context.estimatedTokens === null && context.contextWindow === null
      : context.model !== null &&
        context.estimatedTokens !== null &&
        context.contextWindow !== null &&
        context.contextWindow > 0,
  ),
);
export type ContextUsage = typeof ContextUsage.Type;

export const ATTEMPT_CATEGORIES = [
  "reply",
  "retry",
  "failed",
  "aborted",
  "summarization",
  "title",
] as const;
export const AttemptCategory = Schema.Literals(ATTEMPT_CATEGORIES);
export type AttemptCategory = typeof AttemptCategory.Type;
export const AttemptUsage = Schema.Struct({
  attemptId: DomainUuid,
  category: AttemptCategory,
  model: ChatModelId,
  effort: ChatEffort,
  amount: UsageAmount,
});
export type AttemptUsage = typeof AttemptUsage.Type;

export const SPEECH_UNITS = ["audio_seconds", "characters", "tokens"] as const;
export const SpeechUnit = Schema.Literals(SPEECH_UNITS);
export type SpeechUnit = typeof SpeechUnit.Type;
export const SPEECH_KINDS = ["transcription", "synthesis"] as const;
export const SpeechKind = Schema.Literals(SPEECH_KINDS);
export type SpeechKind = typeof SpeechKind.Type;

/** Chat-attributable speech work in its real billing unit, priced separately. */
export const SpeechUsage = Schema.Struct({
  operationId: DomainUuid,
  chatId: Schema.NullOr(DomainUuid),
  kind: SpeechKind,
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  voice: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40))),
  unit: SpeechUnit,
  quantity: Amount,
  estimatedCostUsd: Amount,
  provenance: UsageProvenance,
  completeness: UsageCompleteness,
}).check(
  Schema.makeFilter((speech) => {
    if (speech.provenance === "unknown")
      return (
        speech.quantity === null &&
        speech.estimatedCostUsd === null &&
        speech.completeness === "unknown"
      );
    if (speech.provenance === "reported" && speech.quantity === null) return false;
    if (speech.completeness === "unknown") return false;
    return (
      speech.completeness !== "complete" ||
      (speech.quantity !== null && speech.estimatedCostUsd !== null)
    );
  }),
);
export type SpeechUsage = typeof SpeechUsage.Type;
export const SpeechUsageTotal = Schema.Struct({ unit: SpeechUnit, quantity: Amount });
export type SpeechUsageTotal = typeof SpeechUsageTotal.Type;

const SpeechTotalsFilter = Schema.makeFilter(
  (units: readonly SpeechUsageTotal[]) =>
    new Set(units.map((total) => total.unit)).size === units.length,
);

export const SpeechUsageTotals = Schema.Struct({
  completeness: UsageCompleteness,
  estimatedCostUsd: Amount,
  units: Schema.Array(SpeechUsageTotal)
    .check(Schema.isMaxLength(SPEECH_UNITS.length))
    .check(SpeechTotalsFilter),
}).check(
  Schema.makeFilter((totals) => {
    const unknownUnits = totals.units.every((total) => total.quantity === null);
    if (totals.completeness === "unknown") return totals.estimatedCostUsd === null && unknownUnits;
    if (totals.completeness === "complete")
      return (
        totals.estimatedCostUsd !== null &&
        (totals.units.length > 0 || totals.estimatedCostUsd === 0) &&
        totals.units.every((total) => total.quantity !== null)
      );
    return !unknownUnits || totals.estimatedCostUsd !== null;
  }),
);
export type SpeechUsageTotals = typeof SpeechUsageTotals.Type;
export const MAX_USAGE_ATTEMPTS = 200;
export const ChatUsage = Schema.Struct({
  completeness: UsageCompleteness,
  amount: UsageAmount,
  context: ContextUsage,
  attempts: Schema.Array(AttemptUsage).check(Schema.isMaxLength(MAX_USAGE_ATTEMPTS)),
  speech: SpeechUsageTotals,
}).check(
  Schema.makeFilter((usage) => {
    if (usage.completeness === "complete")
      return usage.amount.completeness === "complete" && usage.speech.completeness === "complete";
    if (usage.completeness === "unknown")
      return usage.amount.completeness === "unknown" && usage.speech.completeness === "unknown";
    return true;
  }),
);
export type ChatUsage = typeof ChatUsage.Type;
