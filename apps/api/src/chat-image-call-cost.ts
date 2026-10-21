import type { ImageCallCost, ImageCallMetadata } from "./chat-image-call-metadata.ts";
import type { ImageCallState } from "./chat-image-call-schema.ts";
import { CALL_STATE_BYTES, callJson, ImageCallError } from "./chat-image-call-values.ts";

export const initialImageCallCost = (): ImageCallCost => ({
  kind: "unknown",
  missing: ["provider-usage"],
});
const equal = (a: unknown, b: unknown): boolean =>
  callJson(a, CALL_STATE_BYTES) === callJson(b, CALL_STATE_BYTES);
const rank = (cost: ImageCallCost): number =>
  cost.kind === "unknown"
    ? 0
    : cost.kind === "estimated"
      ? cost.completeness === "partial"
        ? 1
        : 2
      : cost.basis === "gateway-estimate"
        ? 3
        : 4;
export function mergeImageCallCost(old: ImageCallCost, next: ImageCallCost): ImageCallCost {
  if (equal(old, next) || next.kind === "unknown") return old;
  if (rank(next) > rank(old)) return next;
  if (rank(next) < rank(old)) return old;
  if (old.kind === "estimated" && next.kind === "estimated" && old.completeness === "partial") {
    const extendsCost = (a: typeof old, b: typeof next) =>
      Object.entries(a.components).every(([key, value]) => b.components[key] === value);
    if (extendsCost(old, next)) return next;
    if (extendsCost(next, old)) return old;
  }
  throw new ImageCallError("conflict");
}
export function mergeImageCallMetadata(
  old: ImageCallMetadata | null,
  next: ImageCallMetadata | undefined,
): ImageCallMetadata | null {
  if (next === undefined) return old;
  if (old === null) return next;
  for (const key of ["model", "provider", "requestId", "quality", "size"] as const)
    if (old[key] !== undefined && next[key] !== undefined && old[key] !== next[key])
      throw new ImageCallError("conflict");
  if (
    old.reportedUsage !== undefined &&
    next.reportedUsage !== undefined &&
    !equal(old.reportedUsage, next.reportedUsage)
  )
    throw new ImageCallError("conflict");
  const outputs = new Map(old.outputs.map((output) => [output.index, output]));
  for (const output of next.outputs) {
    const previous = outputs.get(output.index);
    if (previous !== undefined && !equal(previous, output)) throw new ImageCallError("conflict");
    outputs.set(output.index, output);
  }
  return {
    ...old,
    ...next,
    ...(next.requestId === undefined && old.requestId !== undefined
      ? { requestId: old.requestId }
      : {}),
    ...(next.reportedUsage === undefined && old.reportedUsage !== undefined
      ? { reportedUsage: old.reportedUsage }
      : {}),
    ...(next.quality === undefined && old.quality !== undefined ? { quality: old.quality } : {}),
    ...(next.size === undefined && old.size !== undefined ? { size: old.size } : {}),
    durationMs: Math.max(old.durationMs, next.durationMs),
    cost: mergeImageCallCost(old.cost, next.cost),
    outputs: [...outputs.values()].toSorted((a, b) => a.index - b.index),
  };
}

export type ImageCallTotals = {
  reported: number;
  estimated: number;
  partialEstimated: number;
  unknown: number;
  partial: number;
  other: number;
  known: number;
  notDispatched: number;
};
export function imageCallTotals(state: ImageCallState): ImageCallTotals {
  const totals: ImageCallTotals = {
    reported: 0,
    estimated: 0,
    partialEstimated: 0,
    unknown: 0,
    partial: 0,
    other: 0,
    known: 0,
    notDispatched: 0,
  };
  if (
    state.status === "failed" &&
    !state.dispatched &&
    !state.outcome.uncertain &&
    !state.outcome.storageUncertain
  ) {
    totals.notDispatched = 1;
    return totals;
  }
  const cost = state.cost;
  totals.partial = Number(cost.kind === "estimated" && cost.completeness === "partial");
  if (!state.dispatched || cost.kind === "unknown") totals.unknown = 1;
  else if (cost.kind === "reported") {
    if (cost.currency.toUpperCase() !== "USD") totals.other = 1;
    else {
      totals.known = 1;
      if (cost.basis === "provider-response") totals.reported = cost.amount;
      else totals.estimated = cost.amount;
    }
  } else {
    totals.known = 1;
    if (cost.completeness === "complete") totals.estimated = cost.usd;
    else totals.partialEstimated = cost.usd;
  }
  return totals;
}
export const isUnsettledImageCall = (state: ImageCallState): boolean =>
  state.ownerFinalizationPending ||
  ["prepared", "started", "unresolved"].includes(state.status) ||
  state.outcome.uncertain ||
  state.outcome.storageUncertain;
