/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The bounded facts region must support native keyboard scrolling. */
import { useState } from "react";
import { ImageCostSummary } from "./image-cost-summary";
import { ImageCostRequest } from "./image-cost-request";
import { useImageUsage } from "./image-usage-state";
import "./image-usage.css";

/** Only rendered inside an already-open existing facts/details surface. */
export function ImageUsageDetails({
  messageId,
  pending,
}: { messageId?: string | undefined; pending?: boolean | undefined } = {}) {
  const read = useImageUsage({ messageId, pending });
  const [recentOpen, setRecentOpen] = useState(false);
  const bounded = read.state !== "pending";
  return (
    <section
      data-cx="image-usage"
      data-bounded={bounded}
      aria-label="Image request costs"
      tabIndex={bounded ? 0 : undefined}
    >
      <h3>Images</h3>
      {read.state === "pending" ? (
        <p data-cx="usage-detail-lede">
          Pending. Image facts are read only after this response has a committed native identity.
        </p>
      ) : read.state === "idle" ? (
        <p data-cx="usage-detail-lede">Image cost records are not loaded for this view.</p>
      ) : (
        <>
          {read.value && <ImageCostSummary usage={read.value} response={messageId !== undefined} />}
          {read.state === "loading" && (
            <output data-cx="image-cost-note">
              Reading stored image costs…{read.value ? " Last loaded amounts are kept." : ""}
            </output>
          )}
          {read.state === "error" && (
            <div data-cx="image-cost-read-error" role="alert">
              <span>{read.error}</span>
              <button type="button" onClick={read.retry}>
                Retry reading image costs
              </button>
              <small>This only reads stored accounting.</small>
            </div>
          )}
          {read.value && read.value.recent.length > 0 && (
            <details
              data-cx="image-cost-recent"
              onToggle={(event) => setRecentOpen(event.currentTarget.open)}
            >
              <summary tabIndex={0}>Recent image requests</summary>
              {recentOpen && (
                <>
                  <p data-cx="image-cost-note">
                    Showing {read.value.recent.length} recent records, at most 10. The aggregates
                    above include all recorded requests, not just this list.
                  </p>
                  {read.value.recent.map((call) => (
                    <ImageCostRequest key={call.callId} call={call} />
                  ))}
                </>
              )}
            </details>
          )}
        </>
      )}
    </section>
  );
}
