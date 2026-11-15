import { publicReportModel, publicReportProvider } from "./chat-gateway-report-labels.ts";
import { Schema } from "effect";
import { gatewayOrigin } from "./chat-gateway-config.ts";
import { chatIdentity } from "./chat-gateway-identity.ts";
import { reportSettings } from "./chat-gateway-report-config.ts";
import {
  AggregatedUsage,
  addMetrics,
  dayCount,
  mergeIntervals,
  mergeRow,
  metricsOf,
  reportIntervals,
  zeroMetrics,
  type ReportInterval,
} from "./chat-gateway-report-data.ts";
import {
  UsageDate,
  unknownUsageMetrics,
  type GatewayUsage,
  type UsageCoverage,
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
  const requestedDays = dayCount(period.start, period.end);
  const unavailable: GatewayUsage = {
    status: "unavailable",
    source: "litellm",
    scope: "models",
    timezone: "UTC",
    activation,
    period,
    totals: unknownUsageMetrics(),
    coverage: { start: null, end: null, recordedDays: 0, requestedDays },
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
  let succeeded = 0;
  // Overlapping key windows can cover the same dates, so a failed interval is not
  // always a visible date gap; the failure itself still makes the report partial.
  let hadFailure = false;
  const ranges: ReportInterval[] = [];
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
          // Pinned 1.108.4 declares `timezone` as an integer offset in minutes, so a zone
          // name like "UTC" is rejected as 422 before any aggregation runs. Day keys stay UTC.
          timezone: "0",
        }).toString();
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${settings.credential}` },
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          hadFailure = true;
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
        ranges.push(range);
      } catch {
        // A failed interval contributes no coverage and marks the report partial.
        hadFailure = true;
      }
    }
  }
  if (succeeded === 0) return unavailable;
  const reported = mergeIntervals(ranges);
  const recordedDays = reported.reduce((sum, range) => sum + dayCount(range.start, range.end), 0);
  const coverage: UsageCoverage = {
    start: reported[0]?.start ?? null,
    end: reported.at(-1)?.end ?? null,
    recordedDays,
    requestedDays,
  };
  const unknownMetrics =
    Object.values(totals).some((value) => value === null) ||
    [...daily.values(), ...models.values(), ...providers.values()].some((row) =>
      [row.inputTokens, row.outputTokens, row.requests, row.spend].some((value) => value === null),
    );
  // Partial coverage keeps the recorded sums and states how much of the period they
  // cover; only a wholly unavailable report replaces them with Unknown.
  return {
    ...unavailable,
    status: recordedDays < requestedDays || hadFailure || unknownMetrics ? "partial" : "complete",
    totals,
    coverage,
    daily: rows(daily),
    models: rows(models),
    providers: rows(providers),
  };
};
