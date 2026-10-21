import type { ChatUsageAmount } from "@/lib/chat-capability-usage-types";
import PopupPanel from "./chat-popup";
import { exactTokens, formatCost } from "./chat-usage-format";
import { ImageUsageResponse } from "./image-usage-response";

function Row({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div data-cx="usage-detail-row">
      <dt>{label}</dt>
      <dd>
        {value}
        {note ? <span data-cx="facts-note"> {note}</span> : null}
      </dd>
    </div>
  );
}

const counter = (value: number | null): string => (value === null ? "Unknown" : exactTokens(value));

/**
 * One-click response facts from this message's own nullable usage. A streaming
 * response is Pending; a completed response without counters is honestly
 * Unknown, never another response's numbers.
 */
export default function ChatMessageFacts({
  usage,
  pending,
  anchor,
  onClose,
}: {
  usage: ChatUsageAmount | null;
  pending: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const tokens = usage?.tokens;
  return (
    <PopupPanel anchor={anchor} width={270} label="Response facts" onClose={onClose}>
      <h2 data-cx="chat-popup-title">Response facts</h2>
      {pending ? (
        <p data-cx="usage-detail-lede">In progress. Counters appear after the response settles.</p>
      ) : usage ? (
        <dl data-cx="usage-detail-list">
          <Row label="Input" value={counter(tokens?.inputReported ?? null)} />
          <Row label="Output" value={counter(tokens?.output ?? null)} />
          <Row
            label="Cache read"
            value={counter(tokens?.cacheRead ?? null)}
            note={tokens?.inputReported ? "of input" : undefined}
          />
          <Row
            label="Reasoning"
            value={counter(tokens?.reasoning ?? null)}
            note={tokens?.output ? "of output" : undefined}
          />
          <Row
            label="Estimated cost"
            value={
              usage.estimatedCostUsd === null ? "Unknown" : `~${formatCost(usage.estimatedCostUsd)}`
            }
          />
        </dl>
      ) : (
        <p data-cx="usage-detail-lede">
          This response has no reported counters. Unknown stays unknown rather than borrowing
          another response's numbers.
        </p>
      )}
      <p data-cx="chat-popup-foot">
        {usage
          ? `${usage.provenance} · ${usage.completeness}. Reasoning is part of output; cache read is part of input.`
          : "Reported counters only; unavailable values are never estimated here."}
      </p>
      <ImageUsageResponse pending={pending} />
    </PopupPanel>
  );
}
