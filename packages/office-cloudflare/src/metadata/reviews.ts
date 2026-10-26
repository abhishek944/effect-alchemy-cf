import { operationRecordSql } from "./legacy-failure.ts";
import type { OfficeMetadata, FrozenReview } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import { canonical, conflict, invalid, missing, sqlNow, storeEffect } from "./store.ts";
import { ApprovalRow, ReviewRow, OperationRow } from "./schemas.ts";
import { frozenSQL, noBarrier } from "./native-fence.ts";
import { completeRefs, artifactEdges } from "./artifacts.ts";
import { documentRow } from "./catalog.ts";
import { operationRow } from "./operations.ts";
import { reviewRoots } from "./review-roots.ts";
import { eventStatement, operationEvent } from "./events.ts";

export async function reviewRow(
  db: MetadataStore,
  owner: FrozenReview["owner"],
  id: string,
): Promise<FrozenReview | null> {
  const row = await db.first<{ record: string }>(
    "SELECT record FROM office_meta_reviews WHERE owner=? AND id=?",
    [db.owner(owner), id],
  );
  return row ? db.decode(ReviewRow, row.record) : null;
}
function validateReview(review: FrozenReview): void {
  if (
    review.documentId !== review.destination.documentId ||
    review.unitId !== review.destination.unitId ||
    review.draftRevision !== review.readyRevision ||
    review.generation < 1 ||
    review.readyRevision < 1 ||
    (review.main === null) !== (review.mainRevision === null) ||
    (review.baseline === null) !== (review.baselineRevision === null)
  )
    throw invalid();
  for (const view of [review.main, review.baseline, review.draft, review.result].filter(
    (item) => item !== null,
  )) {
    if (
      view.documentId !== review.documentId ||
      view.mode !== "read-only" ||
      view.nativeTarget.kind !== "pinned-snapshot"
    )
      throw invalid();
  }
  if (
    review.draft.revision !== review.draftRevision ||
    review.draft.nativeTarget.unitId !== review.unitId ||
    (review.main !== null && review.main.revision !== review.mainRevision) ||
    (review.baseline !== null && review.baseline.revision !== review.baselineRevision) ||
    (review.state === "complete" && !review.removed && review.result === null)
  )
    throw invalid();
}
export function createReviews(
  db: MetadataStore,
): Pick<OfficeMetadata, "review" | "putReview" | "approval" | "approve"> {
  return {
    review: (owner, id) => storeEffect(() => reviewRow(db, owner, id)),
    approval: (owner, id) =>
      storeEffect(async () => {
        const row = await db.first<{ record: string }>(
          "SELECT record FROM office_meta_approvals WHERE owner=? AND id=?",
          [db.owner(owner), id],
        );
        return row ? db.decode(ApprovalRow, row.record) : null;
      }),
    putReview: (input) =>
      storeEffect(async () => {
        const review = db.decode(ReviewRow, db.encode(ReviewRow, input));
        validateReview(review);
        const previous = await reviewRow(db, review.owner, review.id);
        if (previous) {
          if (canonical(previous) !== canonical(review)) throw conflict();
          return previous;
        }
        const document = await documentRow(db, review.owner, review.documentId);
        if (
          !document ||
          document.unitId !== review.unitId ||
          document.document.title !== review.destination.title
        )
          throw missing();
        const native = frozenSQL(db, review);
        const barrier = noBarrier(db, review.owner, review.documentId);
        const roots = await reviewRoots(db, review),
          refs = roots.refs;
        const complete = completeRefs(db, review.owner, refs);
        const owner = db.owner(review.owner);
        await db.write(
          `${native.sql} AND ${barrier.sql} AND ${complete.sql} AND ${roots.fence.sql}
        AND NOT EXISTS(SELECT 1 FROM office_meta_reviews WHERE owner=? AND id=?)`,
          [
            ...native.values,
            ...barrier.values,
            ...complete.values,
            ...roots.fence.values,
            owner,
            review.id,
          ],
          [
            [
              "INSERT INTO office_meta_reviews VALUES(?,?,?,?,?,?)",
              [
                owner,
                review.id,
                review.documentId,
                review.fingerprint,
                review.expiresAt,
                db.encode(ReviewRow, review),
              ],
            ],
            ...artifactEdges(db, review.owner, "review", review.id, refs),
            eventStatement(db, review.owner, {
              documentId: review.documentId,
              draftId: null,
              generation: review.generation,
              revision: review.readyRevision,
              operationId: null,
              kind: "draft-state",
            }),
          ],
          "STALE_REVIEW",
        );
        return review;
      }),
    approve: (input) =>
      storeEffect(async () => {
        const approval = db.decode(ApprovalRow, db.encode(ApprovalRow, input));
        const owner = db.owner(approval.owner);
        if (approval.consumedBy !== null) throw invalid();
        const old = await db.first<{ record: string }>(
          "SELECT record FROM office_meta_approvals WHERE owner=? AND id=?",
          [owner, approval.operationId],
        );
        if (old) {
          const previous = db.decode(ApprovalRow, old.record);
          if (canonical({ ...previous, consumedBy: null }) !== canonical(approval))
            throw conflict();
          return previous;
        }
        const review = await reviewRow(db, approval.owner, approval.reviewId);
        if (!review) throw missing();
        const operation = await operationRow(db, approval.owner, approval.operationId);
        if (!operation) throw missing();
        if (!["reserved", "admitted"].includes(operation.receipt.phase))
          throw conflict("NOT_EDITABLE");
        if (
          operation.intent.kind !== "approve" ||
          operation.intent.input.reviewId !== approval.reviewId ||
          operation.documentId !== review.documentId ||
          operation.unitId !== review.unitId ||
          operation.actor.capability !== "human" ||
          operation.actor.principalId !== approval.humanPrincipalId ||
          operation.actor.sessionEpoch !== approval.sessionEpoch ||
          approval.expiresAt > operation.actor.expiresAt ||
          approval.expiresAt > review.expiresAt ||
          approval.fingerprint !== review.fingerprint ||
          review.state !== "complete"
        )
          throw invalid();
        const native = frozenSQL(db, review);
        const barrier = noBarrier(db, approval.owner, review.documentId);
        await db.write(
          `${native.sql} AND ${barrier.sql} AND ?>${sqlNow}
        AND NOT EXISTS(SELECT 1 FROM office_meta_approvals WHERE owner=? AND id=?)
        AND EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=? AND ${operationRecordSql}=? AND phase IN ('reserved','admitted'))`,
          [
            ...native.values,
            ...barrier.values,
            approval.expiresAt,
            owner,
            approval.operationId,
            owner,
            approval.operationId,
            db.encode(OperationRow, operation),
          ],
          [
            [
              "INSERT INTO office_meta_approvals VALUES(?,?,?,NULL,?)",
              [owner, approval.operationId, approval.reviewId, db.encode(ApprovalRow, approval)],
            ],
            eventStatement(
              db,
              approval.owner,
              operationEvent(review.documentId, approval.operationId),
            ),
          ],
          "STALE_REVIEW",
        );
        return approval;
      }),
  };
}
