import { operationRecordSql } from "./legacy-failure.ts";
import { Receipt, decodeWireSync } from "@starter/office-contract";
import type { WritePermit } from "@starter/office-server/ports";
import type { MetadataStore, Statement } from "./store.ts";
import { canonical, conflict, invalid, missing } from "./store.ts";
import { BarrierRow, OperationRow, DocumentRow } from "./schemas.ts";
import { barrierRow } from "./publication-admission.ts";
import { documentRow } from "./catalog.ts";
import { reviewRow } from "./reviews.ts";
import { operationRow } from "./operations.ts";
import { validateAdvance } from "./operation-policy.ts";
import { journalAuthority } from "./write-context.ts";
import { mergeFence } from "./merge-fence.ts";
import { publicationProof } from "./publication-proof.ts";
import { artifactEdges, completeRefs, operationRefs } from "./artifacts.ts";
import { eventStatement, operationEvent } from "./events.ts";
export async function finishPublication(
  db: MetadataStore,
  permit: WritePermit,
  input: typeof Receipt.Type,
): Promise<void> {
  const receipt = decodeWireSync(Receipt)(input),
    previous = await operationRow(db, permit.owner, permit.operationId);
  if (!previous) throw missing();
  if (
    previous.intent.kind !== "merge" ||
    receipt.kind !== "merge" ||
    receipt.operationId !== permit.operationId ||
    previous.documentId !== permit.documentId ||
    previous.unitId !== permit.target.unitId ||
    (receipt.documentId !== null && receipt.documentId !== permit.documentId) ||
    !["confirmed", "needs-attention", "submission-unknown"].includes(receipt.phase)
  )
    throw invalid();
  const barrier = await barrierRow(db, permit.owner, permit.documentId);
  if (!barrier) {
    if (
      previous.receipt.phase === "confirmed" &&
      canonical(previous.receipt) === canonical(receipt)
    )
      return;
    throw missing();
  }
  if (
    barrier.operationId !== permit.operationId ||
    barrier.fingerprint !== permit.reviewFingerprint
  )
    throw conflict("AUTHORITY_LOST");
  const review = await reviewRow(db, permit.owner, barrier.reviewId);
  if (!review) throw missing();
  if (receipt.reviewId !== null && receipt.reviewId !== review.id) throw invalid();
  const record =
    canonical(previous.receipt) === canonical(receipt)
      ? previous
      : { ...previous, receipt, updatedAt: Math.max(previous.updatedAt, Date.now()) };
  if (record !== previous) validateAdvance(previous, record, previous.receipt.version);
  const owner = db.owner(permit.owner),
    scope = db.native(permit.owner, permit.documentId, previous.unitId),
    authority = journalAuthority(db, permit),
    frozen = mergeFence(db, permit);
  const refs = operationRefs(record),
    ready = completeRefs(db, permit.owner, refs);
  let guard = `${authority.sql} AND ${frozen.sql} AND ${ready.sql}
    AND EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=? AND ${operationRecordSql}=? AND claim_worker IS NULL)
    AND EXISTS(SELECT 1 FROM office_meta_barriers WHERE owner=? AND document=? AND record=?)`;
  const values: (string | number | null)[] = [
    ...authority.values,
    ...frozen.values,
    ...ready.values,
    owner,
    permit.operationId,
    db.encode(OperationRow, previous),
    owner,
    permit.documentId,
    db.encode(BarrierRow, barrier),
  ];
  const statements: Statement[] = [];
  if (receipt.phase === "confirmed") {
    if (review.source === "worktree" && review.mainRevision === null && !review.removed) {
      const document = await documentRow(db, permit.owner, permit.documentId);
      if (!document || document.location !== "draft" || receipt.acceptedRevision === null)
        throw conflict("OUTCOME_UNKNOWN");
      guard +=
        " AND EXISTS(SELECT 1 FROM office_meta_documents WHERE owner=? AND id=? AND record=?) AND EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND operation=? AND phase='confirmed' AND json_extract(record,'$.receiptKey.kind')='create-main')";
      values.push(
        owner,
        permit.documentId,
        db.encode(DocumentRow, document),
        owner,
        permit.operationId,
      );
      statements.push([
        "UPDATE office_meta_documents SET record=? WHERE owner=? AND id=?",
        [
          db.encode(DocumentRow, {
            ...document,
            location: "main",
            document: { ...document.document, revision: receipt.acceptedRevision, draftId: null },
          }),
          owner,
          permit.documentId,
        ],
      ]);
    }
    const proof = await publicationProof(db, permit.owner, permit.operationId, scope);
    guard += ` AND (${proof.sql})`;
    values.push(...proof.values);
    guard += ` AND EXISTS(SELECT 1 FROM office_native_worktrees w JOIN office_native_drafts d ON d.scope=w.scope AND d.worktree=w.id
      WHERE w.scope=? AND w.id=? AND w.generation=? AND w.status='merged' AND json_extract(d.merge_result,'$.status') IN ('merged','unchanged','removed')
      AND CASE WHEN json_extract(d.merge_result,'$.status')<>'merged' THEN (? IS NULL AND ${review.mainRevision === null ? "NOT EXISTS(SELECT 1 FROM office_native_units WHERE scope=?)" : "EXISTS(SELECT 1 FROM office_native_units WHERE scope=? AND lifecycle='active' AND head=?)"})
      ELSE (? IS json_extract(d.merge_result,'$.trunkRevision') AND EXISTS(SELECT 1 FROM office_native_units u WHERE u.scope=w.scope AND u.lifecycle='active' AND u.head=json_extract(d.merge_result,'$.trunkRevision'))) END)
      AND EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND operation=? AND phase='confirmed'
        AND json_extract(record,'$.receiptKey.kind')='transition' AND json_extract(record,'$.receiptKey.target')='merged'
        AND json_extract(record,'$.receiptKey.worktreeId')=? AND json_extract(record,'$.receiptKey.generation')=?)`;
    values.push(
      scope,
      review.worktreeId,
      review.generation,
      receipt.acceptedRevision,
      scope,
      ...(review.mainRevision === null ? [] : [review.mainRevision]),
      receipt.acceptedRevision,
      owner,
      permit.operationId,
      review.worktreeId,
      review.generation,
    );
    statements.push([
      "DELETE FROM office_meta_barriers WHERE owner=? AND document=? AND operation=?",
      [owner, permit.documentId, permit.operationId],
    ]);
  } else {
    const attention = { ...barrier, state: "attention" as const };
    statements.push([
      "UPDATE office_meta_barriers SET state='attention',record=? WHERE owner=? AND document=?",
      [db.encode(BarrierRow, attention), owner, permit.documentId],
    ]);
  }
  statements.push(
    [
      "UPDATE office_meta_operations SET version=?,phase=?,record=?,claim_worker=NULL,claim_until=NULL WHERE owner=? AND id=?",
      [receipt.version, receipt.phase, db.encode(OperationRow, record), owner, permit.operationId],
    ],
    ...artifactEdges(db, permit.owner, "operation", permit.operationId, refs),
    eventStatement(db, permit.owner, operationEvent(permit.documentId, permit.operationId)),
  );
  await db.write(guard, values, statements, "OUTCOME_UNKNOWN");
}
