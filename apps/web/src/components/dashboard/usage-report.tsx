import type { ReactNode } from "react";
import type { GatewayUsage, UsageMetrics } from "@/lib/gateway-usage";
import "./usage.css";

export type UsageGrouping = "daily" | "models" | "providers";
const labels = ["Input tokens", "Output tokens", "Chats", "Estimated spend"];
const numbers = new Intl.NumberFormat("en-US");
const compactNumbers = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 8,
});
const amount = (value: number | null, spend = false) =>
  value === null ? "Unknown" : spend ? money.format(value) : numbers.format(value);
const tokenAmount = (value: number | null, compact: boolean) =>
  value === null || !compact ? (
    amount(value)
  ) : (
    <span aria-label={numbers.format(value)} title={numbers.format(value)}>
      {compactNumbers.format(value)}
    </span>
  );
const values = (metrics: UsageMetrics | undefined, count: number | null, compact = true) => [
  tokenAmount(metrics?.inputTokens ?? null, compact),
  tokenAmount(metrics?.outputTokens ?? null, compact),
  amount(count),
  amount(metrics?.spend ?? null, true),
];
const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
/** Include app-active days even when no gateway model report was recorded for that day. */
const dailyRows = (report: GatewayUsage | null) => {
  const rows = new Map((report?.daily ?? []).map((row) => [row.name, row]));
  for (const { date } of report?.activity?.daily ?? []) {
    if (!rows.has(date))
      rows.set(date, {
        name: date,
        inputTokens: null,
        outputTokens: null,
        requests: null,
        spend: null,
      });
  }
  return [...rows.values()].toSorted((a, b) => a.name.localeCompare(b.name));
};

/** Presentation only; account fencing and authenticated loading remain in UsagePage. */
export default function UsageReport({
  report,
  loading,
  failed,
  grouping,
  onGrouping,
  controls,
}: {
  report: GatewayUsage | null;
  loading: boolean;
  failed: boolean;
  grouping: UsageGrouping;
  onGrouping: (value: UsageGrouping) => void;
  controls: ReactNode;
}) {
  const status = loading
    ? "Loading…"
    : failed || report?.status === "unavailable"
      ? "Unavailable"
      : "";
  const rows = grouping === "daily" ? dailyRows(report) : (report?.[grouping] ?? []);
  const activity = report?.activity;
  const dailyChats = new Map(activity?.daily.map((row) => [row.date, row.chats]) ?? []);
  const countLabel = grouping === "daily" ? "Chats" : "Requests";
  const first = grouping === "daily" ? "Day" : grouping === "models" ? "Model" : "Provider";
  return (
    <section data-cx="usage-report" aria-busy={loading}>
      <h1 tabIndex={-1} id="usage-heading">
        Model usage
      </h1>
      <div data-cx="usage-controls">{controls}</div>
      <div data-cx="usage-metrics">
        {values(report?.totals, activity?.total ?? null).map((value, index) => (
          <div key={labels[index]}>
            <span>{labels[index]}</span>
            <strong>{loading ? "…" : value}</strong>
          </div>
        ))}
      </div>
      <div data-cx="usage-breakdowns" aria-label="Usage breakdown">
        {(["daily", "models", "providers"] satisfies UsageGrouping[]).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={grouping === value}
            onClick={() => onGrouping(value)}
          >
            {value[0]?.toUpperCase()}
            {value.slice(1)}
          </button>
        ))}
        <output aria-live="polite">{status}</output>
      </div>
      <div data-cx="usage-table-scroll">
        <table>
          <caption className="sr-only">Model usage by {first.toLowerCase()}</caption>
          <thead>
            <tr>
              {[first, "Input tokens", "Output tokens", countLabel, "Est. spend"].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading &&
              rows.map((row) => (
                <tr key={row.name}>
                  <th scope="row">
                    {grouping === "daily" ? dayLabel(row.name) : row.name || "Unknown"}
                  </th>
                  {values(
                    row,
                    grouping === "daily"
                      ? activity?.total === undefined || activity.total === null
                        ? null
                        : (dailyChats.get(row.name) ?? 0)
                      : row.requests,
                    grouping === "daily",
                  ).map((value, index) => (
                    <td key={labels[index]}>{value}</td>
                  ))}
                </tr>
              ))}
            {(loading || rows.length === 0) && (
              <tr>
                <td colSpan={5} data-cx="usage-empty">
                  {loading ? "Loading…" : status === "Unavailable" ? "Unavailable" : "No usage"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
