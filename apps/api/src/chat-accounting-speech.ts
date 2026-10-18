/**
 * T27 speech totals from bounded per-unit SQL groups: real billing units (audio
 * seconds, characters, tokens) summed per unit with separate completeness and
 * cost. No speech operations at all is a complete zero; missing quantities or
 * prices stay Partial/Unknown and are never invented.
 */
import type { SpeechGroup } from "./chat-accounting-rows.ts";
import type { SpeechUsageTotals, UsageCompleteness } from "./chat-usage-schema.ts";

export const unknownSpeechTotals = (): SpeechUsageTotals => ({
  completeness: "unknown",
  estimatedCostUsd: null,
  units: [],
});

export const speechTotals = (groups: readonly SpeechGroup[]): SpeechUsageTotals => {
  if (groups.length === 0) return { completeness: "complete", estimatedCostUsd: 0, units: [] };
  const units = groups.map((group) => ({ unit: group.unit, quantity: group.quantity }));
  const everyComplete = groups.every((group) => group.completeRows === group.rows);
  const costKnown = groups.every((group) => group.costRows === group.rows);
  const anyKnown = groups.some((group) => group.quantity !== null);
  const cost = groups.reduce((sum, group) => sum + (group.estimatedCostUsd ?? 0), 0);
  const completeness: UsageCompleteness =
    everyComplete && costKnown && units.every((unit) => unit.quantity !== null)
      ? "complete"
      : anyKnown || costKnown
        ? "partial"
        : "unknown";
  return { completeness, estimatedCostUsd: costKnown ? cost : null, units };
};
