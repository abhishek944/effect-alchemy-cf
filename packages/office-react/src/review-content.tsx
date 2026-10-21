import { useState } from "react";
import type { View } from "@starter/office-contract";
import { OfficeNativeEditor } from "./editor.tsx";
import { OfficeChanges } from "./changes.tsx";
import { pinnedReviewView, reviewBlocker, type ReviewEvidence } from "./review-data.ts";
import type { NativeTheme, NativeUser, FrameStatus } from "./frame/messages.ts";
import type { ReviewTab } from "./review-tabs.tsx";

export function ReviewContent({
  evidence,
  tab,
  user,
  theme,
  frameUrl,
  loading,
  more,
  onStatus,
}: {
  readonly evidence: ReviewEvidence | null;
  readonly tab: ReviewTab;
  readonly user: NativeUser;
  readonly theme: NativeTheme;
  readonly frameUrl: string;
  readonly loading: boolean;
  readonly more: () => Promise<void>;
  readonly onStatus: (id: string, status: FrameStatus, revision: number) => void;
}) {
  const [context, setContext] = useState<View | null>(null);
  if (evidence === null) return <p data-office="notice">Exact review evidence unavailable.</p>;
  const { page } = evidence;
  const views = [page.main, page.baseline, page.draft, page.result];
  const openView = (id: string) => {
    const view = views.find((value) => value?.id === id);
    if (view && pinnedReviewView(view, page.documentId)) setContext(view);
  };
  const view = tab === "preview" ? page.result : tab === "changes" ? context : page.draft;
  const native = (candidate: View) => (
    <OfficeNativeEditor
      view={candidate}
      user={user}
      theme={theme}
      channelId={candidate.id}
      frameUrl={frameUrl}
      onStatus={(status, revision) => onStatus(candidate.id, status, revision)}
    />
  );
  if (tab === "changes" && context === null)
    return (
      <>
        <OfficeChanges
          changes={evidence.changes}
          total={page.totalChanges}
          complete={reviewBlocker(evidence) === null}
          onOpenView={openView}
        />
        {page.changes.next !== null && (
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              void more();
            }}
          >
            Load more exact changes
          </button>
        )}
      </>
    );
  if (!pinnedReviewView(view, page.documentId))
    return <p data-office="notice">Exact native view unavailable. This is not an empty result.</p>;
  return (
    <>
      {tab === "preview" && (
        <p data-office="notice">Predicted merge result into reviewed Main. Not yet published.</p>
      )}
      {tab === "changes" && (
        <div data-office="notice">
          Read-only native change context · r{view.revision}
          <button type="button" onClick={() => setContext(null)}>
            Back to exact changes
          </button>
        </div>
      )}
      {native(view)}
      {tab === "result" && (
        <OfficeChanges
          changes={evidence.changes}
          total={page.totalChanges}
          complete={reviewBlocker(evidence) === null}
          compact
        />
      )}
    </>
  );
}
