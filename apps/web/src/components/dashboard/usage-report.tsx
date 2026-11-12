import type { ReactNode } from "react";
import type { GatewayUsage, UsageMetrics } from "@/lib/gateway-usage";
import "./usage.css";

export type UsageGrouping = "daily" | "models" | "providers";
const labels = ["Input tokens", "Output tokens", "Requests", "Estimated spend"];
const numbers = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 8,
});
const amount = (value: number | null, spend = false) =>
  value === null ? "Unknown" : spend ? money.format(value) : numbers.format(value);
const values = (metrics: UsageMetrics | undefined) => [
  amount(metrics?.inputTokens ?? null),
  amount(metrics?.outputTokens ?? null),
  amount(metrics?.requests ?? null),
  amount(metrics?.spend ?? null, true),
];
const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

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
      : report?.status === "partial"
        ? "Partial"
        : "";
  const rows = report?.[grouping] ?? [];
  const first = grouping === "daily" ? "Day" : grouping === "models" ? "Model" : "Provider";
  return (
    <section data-cx="usage-report" aria-busy={loading}>
      <h1 tabIndex={-1} id="usage-heading">
        Model usage
      </h1>
      <div data-cx="usage-controls">{controls}</div>
      <div data-cx="usage-metrics">
        {values(report?.totals).map((value, index) => (
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
              {[first, "Input tokens", "Output tokens", "Requests", "Est. spend"].map((label) => (
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
                  {values(row).map((value, index) => (
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
