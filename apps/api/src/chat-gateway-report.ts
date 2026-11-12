import { publicReportModel, publicReportProvider } from "./chat-gateway-report-labels.ts";
import { Schema } from "effect";
import { gatewayOrigin } from "./chat-gateway-config.ts";
import { chatIdentity } from "./chat-gateway-identity.ts";
import { reportSettings } from "./chat-gateway-report-config.ts";
import {
  AggregatedUsage,
  addMetrics,
  mergeRow,
  metricsOf,
  nextDate,
  reportIntervals,
  zeroMetrics,
} from "./chat-gateway-report-data.ts";
import {
  UsageDate,
  unknownUsageMetrics,
  type GatewayUsage,
  type UsageRow,
} from "@highchat/chat-contract/gateway-usage";

const rows = (values: Map<string, UsageRow>) =>
  [...values.values()].toSorted((a, b) => a.name.localeCompare(b.name));

/** Protected own-user report: no client-owned customer, stage, endpoint or key filters. */
export const readGatewayUsage = async (
  env: Readonly<Record<string, unknown>>,
  ownerId: string,
  period: { readonly start: string; readonly end: string },
): Promise<GatewayUsage> => {
  const activation =
    typeof env.LITELLM_USAGE_ACTIVATED_ON === "string" &&
    Schema.is(UsageDate)(env.LITELLM_USAGE_ACTIVATED_ON)
      ? env.LITELLM_USAGE_ACTIVATED_ON
      : null;
  const unavailable: GatewayUsage = {
    status: "unavailable",
    source: "litellm",
    scope: "models",
    timezone: "UTC",
    activation,
    period,
    totals: unknownUsageMetrics(),
    daily: [],
    models: [],
    providers: [],
  };
  const settings = reportSettings(env);
  const origin = gatewayOrigin(env);
  if (
    settings === null ||
    origin === null ||
    period.start > period.end ||
    period.end > new Date().toISOString().slice(0, 10) ||
    period.end < settings.activation
  )
    return unavailable;
  let customer: string;
  try {
    customer = chatIdentity(env, ownerId, "report").userId;
  } catch {
    return unavailable;
  }
  const start = period.start < settings.activation ? settings.activation : period.start;
  const daily = new Map<string, UsageRow>();
  const models = new Map<string, UsageRow>();
  const providers = new Map<string, UsageRow>();
  let totals = zeroMetrics();
  let partial = period.start < settings.activation;
  let succeeded = 0;
  const coverage: { start: string; end: string }[] = [];
  for (const window of settings.windows) {
    const from = window.start > start ? window.start : start;
    const to = window.end !== null && window.end < period.end ? window.end : period.end;
    if (from > to) continue;
    for (const range of reportIntervals(from, to)) {
      try {
        // Both filters are required and nonblank. One persisted inference-key identity per request.
        const url = new URL("/customer/daily/activity/aggregated", origin);
        url.search = new URLSearchParams({
          end_user_ids: customer,
          api_key: window.apiKey,
          start_date: range.start,
          end_date: range.end,
          timezone: "UTC",
        }).toString();
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${settings.credential}` },
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          partial = true;
          continue;
        }
        const raw: unknown = await response.json();
        const data = Schema.decodeUnknownSync(AggregatedUsage)(raw);
        if (data.results.some((day) => day.date < range.start || day.date > range.end))
          throw new Error("Invalid report period");
        for (const day of data.results) {
          const metrics = metricsOf(day.metrics);
          totals = addMetrics(totals, metrics);
          mergeRow(daily, day.date, metrics);
          for (const [name, bucket] of Object.entries(day.breakdown.models))
            mergeRow(models, publicReportModel(name), metricsOf(bucket.metrics));
          for (const [name, bucket] of Object.entries(day.breakdown.providers))
            mergeRow(providers, publicReportProvider(name), metricsOf(bucket.metrics));
        }
        succeeded += 1;
        coverage.push(range);
      } catch {
        partial = true;
      }
    }
  }
  if (succeeded === 0) return unavailable;
  let cursor = start;
  for (const range of coverage.toSorted((a, b) => a.start.localeCompare(b.start))) {
    if (range.start > cursor) partial = true;
    if (range.end >= cursor) cursor = nextDate(range.end, 1);
  }
  if (cursor <= period.end) partial = true;
  const unknownMetrics =
    Object.values(totals).some((value) => value === null) ||
    [...daily.values(), ...models.values(), ...providers.values()].some((row) =>
      [row.inputTokens, row.outputTokens, row.requests, row.spend].some((value) => value === null),
    );
  // Partial coverage never presents incomplete sums as complete totals.
  return {
    ...unavailable,
    status: partial || unknownMetrics ? "partial" : "complete",
    totals: partial ? unknownUsageMetrics() : totals,
    daily: rows(daily),
    models: rows(models),
    providers: rows(providers),
  };
};
