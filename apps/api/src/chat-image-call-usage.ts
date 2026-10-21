import { ImageUsageSummary } from "./chat-image-call-schema.ts";
import { presentImageUsage, type ImageUsagePresentation } from "./chat-image-presentation.ts";
import type { ImageAssistantPosition, ImageCallTable } from "./chat-image-call-table.ts";
import { decodeCallRow } from "./chat-image-call-codec.ts";
import { CallIndex, callValue, freezeCall, ImageCallError } from "./chat-image-call-values.ts";

export function imageCallUsage(
  table: ImageCallTable,
  position?: ImageAssistantPosition,
): ImageUsagePresentation {
  const { knownUsdCalls, ...totals } = table.aggregate(position);
  callValue(CallIndex, knownUsdCalls, "corrupt");
  if (
    totals.unknownCalls + knownUsdCalls + totals.otherCurrencyCalls + totals.notDispatchedCalls !==
      totals.callCount ||
    totals.startedCalls > totals.callCount ||
    totals.dispatchedCalls > totals.startedCalls ||
    totals.partialCalls > totals.callCount
  )
    throw new ImageCallError("corrupt");
  const incomplete =
    totals.unknownCalls > 0 || totals.otherCurrencyCalls > 0 || totals.partialCalls > 0;
  const completeness = incomplete ? (knownUsdCalls === 0 ? "unknown" : "partial") : "complete";
  const base = callValue(ImageUsageSummary, { ...totals, completeness, recent: [] }, "corrupt");
  const recent = table.recent(position).map((row) => decodeCallRow(row, table.sql));
  // Each private row is bounded independently; only redacted evidence enters the public budget.
  return freezeCall(presentImageUsage(base, recent));
}
