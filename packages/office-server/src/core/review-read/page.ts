import type { ReviewPage } from "@highchat/office-contract";
import type { FrozenReview } from "../../ports/index.ts";
import type { ReviewBundle } from "../review-bundle.ts";
import { officeFailure } from "../failure.ts";

type Item = ReviewPage["changes"]["items"][number];
export function readOffset(cursor: string | null, identity: string, total: number): number {
  if (cursor === null) return 0;
  const match = /^([a-f0-9]{64}):([0-9]+)$/.exec(cursor);
  if (match?.[1] !== identity) throw officeFailure("INVALID_INPUT");
  const offset = Number(match[2]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > total)
    throw officeFailure("INVALID_INPUT");
  return offset;
}

/** Only whole validated changes fit. The real next offset never pretends to be a complete result. */
export function projectPage(
  review: FrozenReview,
  bundle: ReviewBundle,
  identity: string,
  offset: number,
): ReviewPage {
  const items: Item[] = [];
  const page: ReviewPage = {
    reviewId: review.id,
    fingerprint: review.fingerprint,
    documentId: review.documentId,
    main: review.main,
    baseline: review.baseline,
    draft: review.draft,
    result: review.result,
    fidelity: bundle.fidelity,
    readiness: bundle.readiness,
    diagnostics: bundle.diagnostics,
    totalChanges: bundle.totalChanges,
    changes: { items, next: null },
    // This longest status reserves space before the owning native-basis check sets the actual status.
    approval: "incomplete",
  };
  let end = offset;
  for (const item of bundle.changes.slice(offset, offset + 100)) {
    const next = end + 1;
    items.push(item);
    end = next;
  }
  if (end === offset && offset < bundle.totalChanges) throw officeFailure("LIMIT_EXCEEDED");
  const result = {
    ...page,
    changes: { items, next: end < bundle.totalChanges ? identity + ":" + String(end) : null },
  };
  return result;
}
