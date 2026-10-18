/**
 * Projects the bounded ledger groups plus the committed native `pi.usage`
 * snapshot into the authoritative `ChatUsage`. Lifetime totals merge recorded
 * attempts with native per-model buckets; an equal view is exact, a mismatch
 * keeps the fuller counters but is marked Partial because the union price is
 * unknown. Title actuals and speech are additive because native never records
 * them. The `attempts` array is a bounded recent window while totals stay
 * lifetime, and no historical row set is loaded into memory.
 */
import type { UsageState } from "@earendil-works/pi-durable";
import { decodeOption } from "./chat-internal.ts";
import { DomainUuid } from "./chat-capabilities.ts";
import { categoryOfAttempt, emptyCounters, modelIdOf } from "./chat-accounting-model.ts";
import { addCounters } from "./chat-accounting-counters.ts";
import { toUsageAmount } from "./chat-accounting-amount.ts";
import { nativeBuckets, reconcileTotals } from "./chat-accounting-groups.ts";
import type { LifetimeGroup, RecentAttempt, SpeechGroup } from "./chat-accounting-rows.ts";
import { speechTotals, unknownSpeechTotals } from "./chat-accounting-speech.ts";
import {
  ChatUsage,
  type AttemptUsage,
  type ContextUsage,
  type SpeechUsageTotals,
  type TokenCounters,
  type UsageAmount,
  type UsageCompleteness,
} from "./chat-usage-schema.ts";

export const aggregateChatUsage = (input: {
  readonly attempts: readonly LifetimeGroup[];
  readonly titles: readonly LifetimeGroup[];
  readonly speech: readonly SpeechGroup[];
  readonly recent: readonly RecentAttempt[];
  readonly nativeModels: UsageState["models"] | null;
  readonly context: ContextUsage;
}): ChatUsage => {
  const native = nativeBuckets(input.nativeModels);
  const nativeAvailable = input.nativeModels !== null;
  let total: TokenCounters | null = null;
  let cost = 0;
  let costKnown = true;
  let costRecognized = false;
  let unknownRows = 0;
  let uncertain = false;
  const fold = (counters: TokenCounters | null, costUsd: number | null): void => {
    if (counters !== null) total = total === null ? counters : addCounters(total, counters);
    if (costUsd === null) costKnown = false;
    else {
      cost += costUsd;
      costRecognized = true;
    }
  };

  const observed = new Set<string>();
  const foldGroups = (groups: readonly LifetimeGroup[], reconcile: boolean): void => {
    for (const group of groups) {
      unknownRows += group.unknownRows;
      if (group.missingCost) costKnown = false;
      const model = modelIdOf(group.model);
      if (model === null) {
        if (group.knownRows > 0) uncertain = true;
        continue;
      }
      if (!reconcile) {
        // Title actuals are additive; they must not shadow the model's native bucket.
        fold(group.counters, group.costUsd);
        continue;
      }
      observed.add(model);
      const merged = reconcileTotals(native.buckets.get(model), group);
      if (merged === null) continue;
      if (merged.uncertain) uncertain = true;
      fold(merged.counters, merged.costUsd);
    }
  };
  foldGroups(input.attempts, true);
  foldGroups(input.titles, false);
  for (const [model, nativeTotals] of native.buckets) {
    if (!observed.has(model)) fold(nativeTotals.counters, nativeTotals.costUsd);
  }

  const knownRows = [...input.attempts, ...input.titles].reduce(
    (sum, group) => sum + group.knownRows + group.unknownRows,
    0,
  );
  const hasEvidence = knownRows > 0 || input.speech.length > 0 || native.keys > 0;
  const amountKnown = total !== null || costRecognized;
  const amountCompleteness: UsageCompleteness = !amountKnown
    ? "unknown"
    : !costKnown || !costRecognized || !nativeAvailable || unknownRows > 0 || uncertain
      ? "partial"
      : "complete";
  const amount: UsageAmount =
    amountCompleteness === "unknown"
      ? {
          provenance: "unknown",
          completeness: "unknown",
          tokens: emptyCounters(),
          estimatedCostUsd: null,
        }
      : {
          provenance: "reported",
          completeness: amountCompleteness,
          tokens: total ?? emptyCounters(),
          estimatedCostUsd: costRecognized ? cost : null,
        };

  const attempts: AttemptUsage[] = [];
  for (const { attempt, retried } of input.recent) {
    if (attempt.model === null || attempt.effort === null) continue;
    if (decodeOption(DomainUuid, attempt.attemptId) === null) continue;
    attempts.push({
      attemptId: attempt.attemptId,
      category: categoryOfAttempt(attempt.kind, attempt.stopReason, retried),
      model: attempt.model,
      effort: attempt.effort,
      amount: toUsageAmount(attempt.amount),
    });
  }

  const speech: SpeechUsageTotals = hasEvidence
    ? speechTotals(input.speech)
    : unknownSpeechTotals();
  const completeness: UsageCompleteness =
    amount.completeness === "complete" && speech.completeness === "complete"
      ? "complete"
      : amount.completeness === "unknown" && speech.completeness === "unknown"
        ? "unknown"
        : "partial";
  const checked = decodeOption(ChatUsage, {
    completeness,
    amount,
    context: input.context,
    attempts,
    speech,
  });
  if (checked === null) throw new Error("Invalid chat usage");
  return checked;
};
