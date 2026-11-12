import { Schema } from "effect";
import { UsageDate, type UsageMetrics, type UsageRow } from "@highchat/chat-contract/gateway-usage";

const Count = Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= 0));
const Money = Schema.Number.check(Schema.makeFilter((n) => Number.isFinite(n) && n >= 0));
const Metrics = Schema.Struct({
  prompt_tokens: Schema.optionalKey(Count),
  completion_tokens: Schema.optionalKey(Count),
  api_requests: Schema.optionalKey(Count),
  spend: Schema.optionalKey(Money),
});
const Bucket = Schema.Struct({ metrics: Metrics });
export const AggregatedUsage = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      date: UsageDate,
      metrics: Metrics,
      breakdown: Schema.Struct({
        models: Schema.Record(Schema.String, Bucket),
        providers: Schema.Record(Schema.String, Bucket),
      }),
    }),
  ),
  metadata: Schema.Struct({ has_more: Schema.Literal(false), total_pages: Schema.Literal(1) }),
});
export type AggregatedUsage = typeof AggregatedUsage.Type;
export const metricsOf = (value: typeof Metrics.Type): UsageMetrics => ({
  // Core aggregation can emit default zero tokens for non-token images/decisions.
  // Actual attempts with no measured token activity do not prove a free/tokenless call.
  inputTokens: unmeasuredTokens(value) ? null : (value.prompt_tokens ?? null),
  outputTokens: unmeasuredTokens(value) ? null : (value.completion_tokens ?? null),
  requests: value.api_requests ?? null,
  // Aggregate zero with actual attempts cannot distinguish free work from absent pricing.
  spend:
    value.spend === 0 && (value.api_requests === undefined || value.api_requests > 0)
      ? null
      : (value.spend ?? null),
});
const unmeasuredTokens = (value: typeof Metrics.Type): boolean =>
  (value.api_requests ?? 0) > 0 && value.prompt_tokens === 0 && value.completion_tokens === 0;
const add = (left: number | null, right: number | null) =>
  left === null || right === null ? null : left + right;
export const addMetrics = (a: UsageMetrics, b: UsageMetrics): UsageMetrics => {
  return {
    inputTokens: add(a.inputTokens, b.inputTokens),
    outputTokens: add(a.outputTokens, b.outputTokens),
    requests: add(a.requests, b.requests),
    spend: add(a.spend, b.spend),
  };
};
export const zeroMetrics = (): UsageMetrics => ({
  inputTokens: 0,
  outputTokens: 0,
  requests: 0,
  spend: 0,
});
export const mergeRow = (
  rows: Map<string, UsageRow>,
  name: string,
  metrics: UsageMetrics,
): void => {
  const prior = rows.get(name);
  rows.set(name, { name, ...(prior === undefined ? metrics : addMetrics(prior, metrics)) });
};
export const nextDate = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Vendor v1.108.4 permits a 400-day difference and uses inclusive date keys. */
export function* reportIntervals(start: string, end: string) {
  for (let cursor = start; cursor <= end;) {
    const stop = [nextDate(cursor, 400), end].toSorted()[0];
    if (stop === undefined) return;
    yield { start: cursor, end: stop };
    cursor = nextDate(stop, 1);
  }
}
