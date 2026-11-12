import { Schema } from "effect";

export const UsageDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }),
);
export const UsageQuery = Schema.Struct({ start: UsageDate, end: UsageDate });
const Metric = Schema.NullOr(
  Schema.Number.check(Schema.makeFilter((n) => Number.isFinite(n) && n >= 0)),
);
export const UsageMetrics = Schema.Struct({
  inputTokens: Metric,
  outputTokens: Metric,
  requests: Metric,
  spend: Metric,
});
export type UsageMetrics = typeof UsageMetrics.Type;
export const UsageRow = Schema.Struct({ name: Schema.String, ...UsageMetrics.fields });
export type UsageRow = typeof UsageRow.Type;
/** Minimal own-customer projection; never an upstream administrative response. */
export const GatewayUsage = Schema.Struct({
  status: Schema.Literals(["complete", "partial", "unavailable"]),
  source: Schema.Literal("litellm"),
  scope: Schema.Literal("models"),
  timezone: Schema.Literal("UTC"),
  activation: Schema.NullOr(UsageDate),
  period: UsageQuery,
  totals: UsageMetrics,
  daily: Schema.Array(UsageRow),
  models: Schema.Array(UsageRow),
  providers: Schema.Array(UsageRow),
});
export type GatewayUsage = typeof GatewayUsage.Type;
export const unknownUsageMetrics = (): UsageMetrics => ({
  inputTokens: null,
  outputTokens: null,
  requests: null,
  spend: null,
});
