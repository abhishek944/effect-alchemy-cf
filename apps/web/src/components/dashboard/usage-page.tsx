import { useEffect, useState } from "react";
import { getGatewayUsage, type GatewayUsage } from "@/lib/gateway-usage";
import UsageReport, { type UsageGrouping } from "./usage-report";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Keyed by the canonical signed-in account at Workspace; old reads abort on unmount. */
export default function UsagePage() {
  const [period, setPeriod] = useState(() => ({ start: daysAgo(6), end: today() }));
  const [preset, setPreset] = useState("week");
  const [grouping, setGrouping] = useState<UsageGrouping>("daily");
  const [result, setResult] = useState<{
    period: { start: string; end: string };
    report: GatewayUsage | null;
    failed: boolean;
  } | null>(null);
  const loading = result?.period !== period;
  const report = loading ? null : result.report;
  const failed = !loading && result.failed;
  const activation = result?.report?.activation;
  useEffect(() => {
    document.getElementById("usage-heading")?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const load = async () => {
      try {
        const value = await getGatewayUsage(period, controller.signal);
        if (current) setResult({ period, report: value, failed: false });
      } catch {
        if (current) setResult({ period, report: null, failed: true });
      }
    };
    void load();
    return () => {
      current = false;
      controller.abort();
    };
  }, [period]);
  const choosePeriod = (value: string) => {
    setPreset(value);
    if (value === "week") setPeriod({ start: daysAgo(6), end: today() });
    else if (value === "month") setPeriod({ start: `${today().slice(0, 8)}01`, end: today() });
    else if (value === "all" && activation) setPeriod({ start: activation, end: today() });
  };
  return (
    <UsageReport
      report={report}
      loading={loading}
      failed={failed}
      grouping={grouping}
      onGrouping={setGrouping}
      controls={
        <>
          <div data-cx="usage-period">
            <select
              aria-label="Date range"
              value={preset}
              onChange={(event) => choosePeriod(event.target.value)}
            >
              <option value="week">Last 7 days</option>
              <option value="month">This month</option>
              <option value="all" disabled={!activation}>
                Since activation
              </option>
              <option value="custom">Custom range</option>
            </select>
            {preset === "custom" && (
              <>
                <input
                  aria-label="Start date"
                  type="date"
                  value={period.start}
                  min={activation ?? undefined}
                  max={period.end}
                  onChange={(event) => {
                    if (event.target.value) setPeriod({ ...period, start: event.target.value });
                  }}
                />
                <input
                  aria-label="End date"
                  type="date"
                  value={period.end}
                  min={period.start}
                  max={today()}
                  onChange={(event) => {
                    if (event.target.value) setPeriod({ ...period, end: event.target.value });
                  }}
                />
              </>
            )}
          </div>
          <button type="button" onClick={() => setPeriod({ ...period })} disabled={loading}>
            Refresh
          </button>
        </>
      }
    />
  );
}
