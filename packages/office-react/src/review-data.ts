import type { ReviewPage, View } from "@starter/office-contract";

export type ReviewChange = ReviewPage["changes"]["items"][number];
export type ReviewEvidence = {
  readonly page: ReviewPage;
  readonly changes: readonly ReviewChange[];
};
export const reviewIdentity = (page: ReviewPage) =>
  JSON.stringify([
    page.reviewId,
    page.fingerprint,
    page.documentId,
    page.main?.id,
    page.main?.revision,
    page.baseline?.id,
    page.baseline?.revision,
    page.draft?.id,
    page.draft?.revision,
    page.result?.id,
    page.result?.revision,
  ]);
export function pinnedReviewView(view: View | null, documentId: string): view is View {
  return (
    view !== null &&
    view.documentId === documentId &&
    view.mode === "read-only" &&
    view.nativeTarget.kind === "pinned-snapshot"
  );
}
export function reviewBlocker(evidence: ReviewEvidence): string | null {
  const { page, changes } = evidence;
  if (page.approval === "stale")
    return "Main changed. Refresh the result, exact changes and merge preview.";
  if (page.approval === "conflict")
    return "The merge preview has a conflict. Reopen and resolve the draft.";
  if (page.approval !== "available" || page.readiness !== "ready" || page.diagnostics.length > 0)
    return "Review evidence is incomplete. Approval is unavailable.";
  if (
    !pinnedReviewView(page.draft, page.documentId) ||
    !pinnedReviewView(page.result, page.documentId)
  )
    return "Exact frozen result or merge preview is unavailable.";
  if (page.changes.next !== null || changes.length !== page.totalChanges)
    return "Load the remaining exact changes before approving this result.";
  const views = [page.main, page.baseline, page.draft, page.result];
  for (const change of changes)
    for (const leaf of change.leaves)
      for (const value of [leaf.before, leaf.after]) {
        if (
          value.kind === "native-view" &&
          !views.some(
            (view) => view?.id === value.viewId && pinnedReviewView(view, page.documentId),
          )
        )
          return "A complex change has no exact native context. Approval is unavailable.";
      }
  return null;
}
export function appendReviewPage(current: ReviewEvidence, page: ReviewPage): ReviewEvidence {
  if (
    reviewIdentity(current.page) !== reviewIdentity(page) ||
    current.page.totalChanges !== page.totalChanges
  )
    throw new Error("Review identity changed while loading exact changes.");
  const changes = [...current.changes, ...page.changes.items];
  if (changes.length > 5000)
    throw new Error("Review exceeds the supported browser comparison budget.");
  if (
    new Set(changes.map((change) => change.id)).size !== changes.length ||
    changes.length > page.totalChanges
  )
    throw new Error("Exact comparison pages are inconsistent.");
  return { page, changes };
}
