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
const Days = Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= 0));
/** How much of the requested period an upstream report actually recorded. */
export const UsageCoverage = Schema.Struct({
  /** First recorded day; null when no interval succeeded. */
  start: Schema.NullOr(UsageDate),
  end: Schema.NullOr(UsageDate),
  /** Days covered by successful intervals, inside the requested period. */
  recordedDays: Days,
  /** Days in the requested inclusive period. */
  requestedDays: Days,
});
export type UsageCoverage = typeof UsageCoverage.Type;
/** Minimal own-customer projection; never an upstream administrative response. */
export const GatewayUsage = Schema.Struct({
  status: Schema.Literals(["complete", "partial", "unavailable"]),
  source: Schema.Literal("litellm"),
  scope: Schema.Literal("models"),
  timezone: Schema.Literal("UTC"),
  activation: Schema.NullOr(UsageDate),
  period: UsageQuery,
  /** Sums of the recorded rows; never widened to the uncovered days. */
  totals: UsageMetrics,
  coverage: UsageCoverage,
  daily: Schema.Array(UsageRow),
  models: Schema.Array(UsageRow),
  providers: Schema.Array(UsageRow),
});
export type GatewayUsage = typeof GatewayUsage.Type;

const Count = Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= 0));
export const ConversationActivity = Schema.Struct({ days: Schema.Array(UsageDate) });
export type ConversationActivity = typeof ConversationActivity.Type;

/** App-owned sent-message activity, independent of gateway attempts and coverage. */
export const ChatActivity = Schema.Struct({
  source: Schema.Literal("app"),
  total: Schema.NullOr(Count),
  daily: Schema.Array(Schema.Struct({ date: UsageDate, chats: Count })),
});
export type ChatActivity = typeof ChatActivity.Type;
export const unknownChatActivity = (): ChatActivity => ({ source: "app", total: null, daily: [] });

export const AccountUsage = Schema.Struct({
  ...GatewayUsage.fields,
  // An older retained API can still supply valid gateway metrics during a source reload.
  activity: Schema.optionalKey(ChatActivity),
});
export type AccountUsage = typeof AccountUsage.Type;
export const unknownUsageMetrics = (): UsageMetrics => ({
  inputTokens: null,
  outputTokens: null,
  requests: null,
  spend: null,
});
