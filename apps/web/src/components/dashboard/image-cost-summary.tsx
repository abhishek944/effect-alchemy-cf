import type { ImageUsagePresentation } from "@/lib/image-usage-types";
import { imageMoney } from "./image-cost-format";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div data-cx="usage-detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ImageCostSummary({
  usage,
  response,
}: {
  usage: ImageUsagePresentation;
  response: boolean;
}) {
  if (usage.callCount === 0)
    return (
      <p data-cx="usage-detail-lede">
        No image requests recorded{response ? " for this response" : " in this chat"}.
      </p>
    );
  const knownUsd =
    usage.callCount - usage.unknownCalls - usage.otherCurrencyCalls - usage.notDispatchedCalls;
  return (
    <>
      <p data-cx="usage-detail-lede">
        {usage.completeness === "complete"
          ? "Complete USD cost coverage."
          : usage.completeness === "partial"
            ? "Partial USD cost coverage."
            : "USD image cost coverage is unknown."}
        {response
          ? " All recorded requests for this exact response."
          : " Lifetime image requests for this chat."}
      </p>
      <dl data-cx="usage-detail-list">
        <Row label="Image requests" value={String(usage.callCount)} />
        <Row
          label="Dispatched"
          value={`${usage.dispatchedCalls} · ${usage.notDispatchedCalls} not dispatched`}
        />
        <Row
          label="Reported USD contributions"
          value={knownUsd > 0 ? imageMoney(usage.reportedUsd) : "Not reported"}
        />
        <Row
          label="Complete estimates + Gateway estimates"
          value={knownUsd > 0 ? imageMoney(usage.estimatedUsd) : "Not available"}
        />
        {usage.partialCalls > 0 && (
          <Row
            label="Partial known components (not a total)"
            value={knownUsd > 0 ? imageMoney(usage.partialEstimatedUsd) : "Unknown"}
          />
        )}
        {usage.unknownCalls > 0 && (
          <Row label="Unknown request costs" value={String(usage.unknownCalls)} />
        )}
        {usage.partialCalls > 0 && (
          <Row label="Partial estimates" value={String(usage.partialCalls)} />
        )}
        {usage.otherCurrencyCalls > 0 && (
          <Row
            label="Other currencies"
            value={`${usage.otherCurrencyCalls} requests · not converted`}
          />
        )}
      </dl>
      <p data-cx="image-cost-note">
        These categories stay separate. Partial known components are not a complete total; unknown
        costs are never zero. Image requests are separate from native text and speech usage.
      </p>
    </>
  );
}
