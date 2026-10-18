/**
 * T27 counter arithmetic over the authoritative `TokenCounters` shape. Every
 * combination rebuilds `inputReported` from the final components, so recorded
 * input can never disagree with uncached + cacheRead + cacheWrite. Missing
 * numbers stay null; zero is never invented.
 */
import type { TokenCounters } from "./chat-usage-schema.ts";

/** The provider-reported fields T27 reads; architecturally assignable from Usage. */
export type NativeUsage = {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly cacheWrite1h?: number | undefined;
  readonly reasoning?: number | undefined;
  readonly totalTokens: number;
  readonly cost?: { readonly total: number } | undefined;
};

/** Recorded native cost, or null when the provider/SDK reported no price. */
export const nativeCostOf = (usage: NativeUsage): number | null => {
  const total = usage.cost?.total;
  return typeof total === "number" && Number.isFinite(total) && total > 0 ? total : null;
};

const safeCounter = (value: number): number | null =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;

const countersOf = (
  inputUncached: number | null,
  inputReported: number | null,
  output: number | null,
  cacheRead: number | null,
  cacheWrite: number | null,
  reasoning: number | null,
): TokenCounters => ({
  inputUncached,
  inputReported:
    inputUncached !== null && cacheRead !== null && cacheWrite !== null
      ? inputUncached + cacheRead + cacheWrite
      : inputReported,
  output,
  cacheRead,
  cacheWrite,
  reasoning,
});

/** Stored columns back to counters; all-null means absent, never zero. */
export const countersFromColumns = (
  inputUncached: number | null,
  output: number | null,
  cacheRead: number | null,
  cacheWrite: number | null,
  reasoning: number | null,
): TokenCounters | null =>
  inputUncached === null &&
  output === null &&
  cacheRead === null &&
  cacheWrite === null &&
  reasoning === null
    ? null
    : countersOf(inputUncached, null, output, cacheRead, cacheWrite, reasoning);

export const countersOfUsage = (usage: NativeUsage): TokenCounters =>
  countersOf(
    safeCounter(usage.input),
    null,
    safeCounter(usage.output),
    safeCounter(usage.cacheRead),
    safeCounter(usage.cacheWrite),
    usage.reasoning === undefined ? null : safeCounter(usage.reasoning),
  );

/** Provider-reported use; an all-zero SDK usage means no provider numbers exist. */
export const reportedUsage = (usage: NativeUsage): boolean =>
  usage.input > 0 ||
  usage.output > 0 ||
  usage.cacheRead > 0 ||
  usage.cacheWrite > 0 ||
  usage.totalTokens > 0;

const add = (left: number | null, right: number | null): number | null =>
  left === null || right === null ? null : left + right;
const addOptional = (left: number | null, right: number | null): number | null =>
  left === null ? right : right === null ? left : left + right;
const high = (left: number | null, right: number | null): number | null =>
  left === null ? right : right === null ? left : Math.max(left, right);

const combine = (
  left: TokenCounters,
  right: TokenCounters,
  pick: (a: number | null, b: number | null) => number | null,
  reasoning: (a: number | null, b: number | null) => number | null,
): TokenCounters =>
  countersOf(
    pick(left.inputUncached, right.inputUncached),
    null,
    pick(left.output, right.output),
    pick(left.cacheRead, right.cacheRead),
    pick(left.cacheWrite, right.cacheWrite),
    reasoning(left.reasoning, right.reasoning),
  );

/** Sums two known counter sets; reasoning is carried but never added to output. */
export const addCounters = (left: TokenCounters, right: TokenCounters): TokenCounters =>
  combine(left, right, add, addOptional);

/** Reconciles two views of the same work without double counting. */
export const maxCounters = (
  left: TokenCounters | null,
  right: TokenCounters | null,
): TokenCounters | null => {
  if (left === null) return right;
  if (right === null) return left;
  return combine(left, right, high, high);
};
