/**
 * T27 per-model reconciliation used by the lifetime projection: committed
 * native `pi.usage` buckets mapped to catalog ids, and the honest merge with
 * the durable attempt ledger. When the two views differ the union is not exact:
 * the fuller counters are used, the cost only covers a single fuller side, and
 * the caller marks the amount Partial instead of claiming an exact union.
 */
import type { UsageState } from "@earendil-works/pi-durable";
import { installedChatModel } from "./chat-capability-catalog.ts";
import { modelOfBucket } from "./chat-accounting-model.ts";
import {
  addCounters,
  countersOfUsage,
  maxCounters,
  nativeCostOf,
  reportedUsage,
} from "./chat-accounting-counters.ts";
import { costOfCounters } from "./chat-accounting-amount.ts";
import type { TokenCounters } from "./chat-usage-schema.ts";
import type { LifetimeGroup } from "./chat-accounting-rows.ts";

export type ModelTotals = { counters: TokenCounters; costUsd: number | null };
export type Reconcile = { counters: TokenCounters; costUsd: number | null; uncertain: boolean };

const foldCost = (current: number | null, next: number | null): number | null =>
  current === null || next === null ? null : current + next;

/** Committed native model buckets, mapped to catalog ids where possible. */
export const nativeBuckets = (nativeModels: UsageState["models"] | null) => {
  const buckets = new Map<string, ModelTotals>();
  let keys = 0;
  if (nativeModels === null) return { buckets, keys };
  for (const [bucket, usage] of Object.entries(nativeModels)) {
    keys += 1;
    if (!reportedUsage(usage)) continue;
    const counters = countersOfUsage(usage);
    const model = modelOfBucket(bucket);
    const nativeCost = nativeCostOf(usage);
    const pricing = model === null ? null : (installedChatModel(model)?.pricing ?? null);
    const costUsd = nativeCost ?? (pricing === null ? null : costOfCounters(pricing, counters));
    const key = model ?? bucket;
    const current = buckets.get(key);
    buckets.set(
      key,
      current === undefined
        ? { counters, costUsd }
        : {
            counters: addCounters(current.counters, counters),
            costUsd: foldCost(current.costUsd, costUsd),
          },
    );
  }
  return { buckets, keys };
};

const exceeds = (left: number | null, right: number | null): boolean =>
  left !== null && right !== null && left > right;

const anyExceeds = (left: TokenCounters, right: TokenCounters): boolean =>
  exceeds(left.inputUncached, right.inputUncached) ||
  exceeds(left.output, right.output) ||
  exceeds(left.cacheRead, right.cacheRead) ||
  exceeds(left.cacheWrite, right.cacheWrite) ||
  exceeds(left.reasoning, right.reasoning);

/**
 * Merge one model's native and recorded views. Equal views are exact. A
 * mismatch keeps the element-wise maximum counters but prices only the fuller
 * side, because a union price is unknown; the caller marks it uncertain.
 */
export const reconcileTotals = (
  native: ModelTotals | undefined,
  own: LifetimeGroup,
): Reconcile | null => {
  if (own.counters === null) {
    return native === undefined
      ? null
      : { counters: native.counters, costUsd: native.costUsd, uncertain: false };
  }
  if (native === undefined) {
    return { counters: own.counters, costUsd: own.costUsd, uncertain: false };
  }
  const counters = maxCounters(native.counters, own.counters);
  if (counters === null) return null;
  const ownExtra = anyExceeds(own.counters, native.counters);
  const nativeExtra = anyExceeds(native.counters, own.counters);
  if (!ownExtra && !nativeExtra) {
    return { counters, costUsd: native.costUsd ?? own.costUsd, uncertain: false };
  }
  const costUsd =
    ownExtra && !nativeExtra ? own.costUsd : nativeExtra && !ownExtra ? native.costUsd : null;
  return { counters, costUsd, uncertain: true };
};
