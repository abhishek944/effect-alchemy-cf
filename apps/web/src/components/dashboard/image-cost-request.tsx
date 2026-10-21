import { useState } from "react";
import type { ImageCallPresentation, ImageUsageValue } from "@/lib/image-usage-types";
import { formatFileSize } from "@/lib/chat-file-local";
import { imageCostAmount, imageCostLabel, imageEvidence, imageMoney } from "./image-cost-format";

function numericUsage(value: ImageUsageValue, path = ""): [string, number][] {
  if (typeof value === "number") return [[path, value]];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    numericUsage(child, path ? `${path}/${key}` : key),
  );
}

export function ImageCostRequest({ call }: { call: ImageCallPresentation }) {
  const [open, setOpen] = useState(false);
  const evidence = imageEvidence(call.cost);
  const metadata = call.metadata;
  const usage = metadata?.reportedUsage ? numericUsage(metadata.reportedUsage) : [];
  return (
    <details data-cx="image-cost-request" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary tabIndex={0}>
        {imageCostLabel(call.cost)} · {imageCostAmount(call.cost)}
        <small>
          {call.status} · {call.outputCount} recorded outputs
        </small>
      </summary>
      {open && (
        <>
          <p data-cx="image-cost-note">
            One request cost, never multiplied by its output count.{" "}
            {call.dispatched ? "Dispatched." : "Dispatch not recorded."}
          </p>
          {(call.uncertain || call.storageUncertain || call.partial) && (
            <p data-cx="image-cost-note">
              {call.uncertain ? "Provider outcome uncertain. " : ""}
              {call.storageUncertain ? "Original storage uncertain. " : ""}
              {call.partial ? "Partial output outcome." : ""}
            </p>
          )}
          {call.cost.kind === "reported" && call.cost.basis === "gateway-estimate" && (
            <p data-cx="image-cost-note">Gateway estimate, not a provider-reported charge.</p>
          )}
          {call.cost.kind === "estimated" && (
            <dl data-cx="usage-detail-list">
              {Object.entries(call.cost.components).map(([name, amount]) => (
                <div key={name} data-cx="usage-detail-row">
                  <dt>{name}</dt>
                  <dd>{imageMoney(amount)}</dd>
                </div>
              ))}
            </dl>
          )}
          {evidence.missing.length > 0 && (
            <p data-cx="image-cost-note">
              <strong>Missing:</strong> {evidence.missing.slice(0, 8).join(" · ")}
              {evidence.missing.length > 8
                ? ` · ${evidence.missing.length - 8} more missing fields`
                : ""}
            </p>
          )}
          {evidence.sources.length > 0 && (
            <p data-cx="image-cost-note">
              <strong>Evidence:</strong> {evidence.sources.slice(0, 8).join(" · ")}
              {evidence.sources.length > 8 ? ` · ${evidence.sources.length - 8} more sources` : ""}
            </p>
          )}
          {metadata && (
            <>
              <p data-cx="image-cost-note">
                {metadata.model} · {metadata.provider} · {metadata.durationMs} ms
                {metadata.size ? ` · ${metadata.size}` : ""}
                {metadata.quality ? ` · ${metadata.quality}` : ""}
              </p>
              {metadata.requestId && (
                <p data-cx="image-cost-note">Request ID: {metadata.requestId}</p>
              )}
              {metadata.outputs.slice(0, 10).map((output) => (
                <p key={output.index} data-cx="image-cost-note">
                  Output index {output.index}: {output.mimeType} · {formatFileSize(output.bytes)}
                  {output.width ? ` · width ${output.width}` : ""}
                  {output.height ? ` · height ${output.height}` : ""}
                </p>
              ))}
              {metadata.outputs.length > 10 && (
                <p data-cx="image-cost-note">
                  Showing 10 of {metadata.outputs.length} output descriptors; this does not cap
                  generation.
                </p>
              )}
              {usage.length > 0 && (
                <details>
                  <summary tabIndex={0}>Provider usage fields</summary>
                  <p data-cx="image-cost-note">
                    Provider-reported evidence, not native text counters.
                  </p>
                  <dl data-cx="usage-detail-list">
                    {usage.slice(0, 12).map(([name, amount]) => (
                      <div key={name} data-cx="usage-detail-row">
                        <dt>{name}</dt>
                        <dd>{String(amount)}</dd>
                      </div>
                    ))}
                  </dl>
                  {usage.length > 12 && (
                    <p data-cx="image-cost-note">
                      Showing 12 of {usage.length} numeric provider fields.
                    </p>
                  )}
                </details>
              )}
            </>
          )}
          <p data-cx="image-cost-note">
            Response {call.messageId} · Record {call.callId}
          </p>
        </>
      )}
    </details>
  );
}
