import { useState } from "react";
import type { Receipt } from "@starter/office-contract";
import { useReviewActions } from "./review-actions.ts";
import { reviewBlocker } from "./review-data.ts";
import { useReviewEvidence } from "./use-review-evidence.ts";
import { ReviewTabs, type ReviewTab } from "./review-tabs.tsx";
import { ReviewContent } from "./review-content.tsx";
import type { NativeTheme, NativeUser } from "./frame/messages.ts";
import type { OfficeRuntime, OfficeActionAdmission } from "./runtime.ts";

export type OfficeReviewProps = OfficeRuntime &
  OfficeActionAdmission & {
    readonly reviewId: string;
    readonly user: NativeUser;
    readonly theme: NativeTheme;
    readonly frameUrl: string;
    readonly onOperation: (operationId: string) => void;
    readonly onReceipt: (receipt: Receipt) => void;
    readonly onReopen?: () => void;
  };
function ReviewSurface(props: OfficeReviewProps) {
  const { evidence, loading, error, more, refresh } = useReviewEvidence(props, props.reviewId);
  const [tab, setTab] = useState<ReviewTab>("result");
  const actions = useReviewActions(props, evidence, props.onOperation, props.onReceipt);
  const page = evidence?.page;
  const blocker =
    evidence === null
      ? "Load complete exact review evidence before approval."
      : reviewBlocker(evidence);
  const blocked = blocker ?? error;
  return (
    <section
      data-office="review"
      data-office-theme={props.theme}
      aria-label="Native document review"
    >
      <div data-office="scope">
        <strong>Review · Frozen draft{page?.draft ? ` r${page.draft.revision}` : ""}</strong>
        <span>Main{page?.main ? ` r${page.main.revision}` : " not created"} unchanged</span>
      </div>
      <ReviewTabs id={props.reviewId} tab={tab} total={page?.totalChanges} onChange={setTab} />
      {loading && (
        <output data-office="notice" aria-live="polite">
          Loading exact review evidence…
        </output>
      )}
      {(error || blocked) && (
        <div data-office="notice" role="alert">
          {error || blocked}
          <button type="button" disabled={loading || actions.pending} onClick={refresh}>
            Refresh review
          </button>
        </div>
      )}
      {page && page.diagnostics.length > 0 && (
        <ul data-office="notice">
          {page.diagnostics.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
      <div
        id={`office-review-${props.reviewId}`}
        data-office="review-body"
        role="tabpanel"
        aria-labelledby={`office-tab-${props.reviewId}-${tab}`}
      >
        <ReviewContent
          key={`${tab}:${page?.fingerprint ?? "loading"}`}
          client={props.client}
          run={props.run}
          evidence={evidence}
          tab={tab}
          user={props.user}
          theme={props.theme}
          frameUrl={props.frameUrl}
          loading={loading}
          more={more}
        />
      </div>
      <div data-office="review-actions">
        <small>
          {page
            ? `Only frozen draft r${page.draft?.revision ?? "?"} and Main ${page.main?.revision ?? "absence"}.`
            : "Exact revision approval unavailable."}
        </small>
        {props.onReopen && (
          <button type="button" disabled={actions.busy || actions.pending} onClick={props.onReopen}>
            Reopen
          </button>
        )}
        {actions.pending ? (
          <button
            type="button"
            disabled={actions.busy || props.disabled}
            onClick={() => {
              void actions.observe();
            }}
          >
            Check operation
          </button>
        ) : (
          <button
            type="button"
            data-office="primary"
            disabled={
              blocked !== null || loading || actions.busy || actions.attempted || props.disabled
            }
            aria-describedby={`office-approval-${props.reviewId}`}
            onClick={(event) => {
              if (event.isTrusted) void actions.approve();
            }}
          >
            Approve exact result
          </button>
        )}
      </div>
      <output id={`office-approval-${props.reviewId}`} data-office="notice" aria-live="polite">
        {actions.message || blocked || "Approval publishes only this exact reviewed result."}
      </output>
    </section>
  );
}
export function OfficeReview(props: OfficeReviewProps) {
  return <ReviewSurface key={`${props.reviewId}:${props.user.id}:${props.frameUrl}`} {...props} />;
}
