import { operationRecordSql } from "./legacy-failure.ts";
import { Digest, Id, decodeWireSync } from "@starter/office-contract";
import type {
  ApprovalRecord,
  OperationRecord,
  OwnerScope,
  PublicationBarrier,
  WritePermit,
} from "@starter/office-server/ports";
import type { MetadataStore, Statement } from "./store.ts";
import { canonical, conflict, invalid, missing, sqlNow } from "./store.ts";
import { ApprovalRow, BarrierRow, OperationRow } from "./schemas.ts";
import { frozenSQL, permitSQL } from "./native-fence.ts";
import { operationRow } from "./operations.ts";
import { operationIdentity, validateOperation, validateAdvance } from "./operation-policy.ts";
import { reviewRow } from "./reviews.ts";
import { artifactEdges, completeRefs, operationRefs } from "./artifacts.ts";
import { eventStatement, operationEvent } from "./events.ts";
export async function barrierRow(
  db: MetadataStore,
  owner: OwnerScope,
  documentId: string,
): Promise<PublicationBarrier | null> {
  decodeWireSync(Id)(documentId);
  const row = await db.first<{ record: string }>(
    "SELECT record FROM office_meta_barriers WHERE owner=? AND document=?",
    [db.owner(owner), documentId],
  );
  return row ? db.decode(BarrierRow, row.record) : null;
}
export async function admitPublication(
  db: MetadataStore,
  permit: WritePermit,
  input: OperationRecord,
  approvalId: string,
  fingerprint: string,
): Promise<PublicationBarrier> {
  decodeWireSync(Id)(approvalId);
  decodeWireSync(Digest)(fingerprint);
  const record = db.decode(OperationRow, db.encode(OperationRow, input));
  validateOperation(record);
  const owner = db.owner(record.owner),
    id = record.receipt.operationId;
  if (
    canonical(record.owner) !== canonical(permit.owner) ||
    record.documentId !== permit.documentId ||
    record.unitId !== permit.target.unitId ||
    id !== permit.operationId ||
    record.intent.kind !== "merge" ||
    record.intent.input.approvalOperationId !== approvalId ||
    record.actor.capability !== "human" ||
    permit.reviewFingerprint !== fingerprint
  )
    throw invalid();
  const approvalRow = await db.first<{ record: string }>(
    "SELECT record FROM office_meta_approvals WHERE owner=? AND id=?",
    [owner, approvalId],
  );
  if (!approvalRow) throw missing();
  const approval = db.decode(ApprovalRow, approvalRow.record),
    review = await reviewRow(db, record.owner, approval.reviewId);
  if (!review) throw missing();
  if (
    review.state !== "complete" ||
    review.documentId !== record.documentId ||
    review.unitId !== record.unitId ||
    record.worktreeId !== review.worktreeId ||
    record.policyVersion !== review.policyVersion ||
    approval.fingerprint !== fingerprint ||
    review.fingerprint !== fingerprint ||
    approval.humanPrincipalId !== record.actor.principalId ||
    approval.sessionEpoch !== record.actor.sessionEpoch
  )
    throw conflict("STALE_REVIEW");
  const previous = await operationRow(db, record.owner, id),
    existing = await barrierRow(db, record.owner, record.documentId);
  if (previous && canonical(operationIdentity(previous)) !== canonical(operationIdentity(record)))
    throw conflict();
  if (existing) {
    if (
      existing.operationId !== id ||
      existing.approvalOperationId !== approvalId ||
      existing.reviewId !== review.id ||
      existing.fingerprint !== fingerprint ||
      approval.consumedBy !== id ||
      !previous
    )
      throw conflict("BUSY");
    return existing;
  }
  if (
    approval.consumedBy !== null ||
    !["reserved", "admitted"].includes(record.receipt.phase) ||
    record.receipt.acceptedRevision !== null
  )
    throw conflict("NOT_EDITABLE");
  if (previous) {
    if (canonical(previous) !== canonical(record))
      validateAdvance(previous, record, previous.receipt.version);
  } else if (record.receipt.version > 1) throw invalid();
  if (
    permit.target.scope.kind === "main"
      ? permit.expectedHead !== review.mainRevision
      : permit.expectedGeneration !== review.generation ||
        permit.target.scope.generation !== review.generation ||
        permit.expectedHead !== review.draftRevision
  )
    throw conflict("STALE_REVIEW");
  const fence = permitSQL(db, permit),
    frozen = frozenSQL(db, review),
    refs = operationRefs(record),
    ready = completeRefs(db, record.owner, refs);
  const result: PublicationBarrier = {
    owner: record.owner,
    documentId: record.documentId,
    operationId: id,
    approvalOperationId: approvalId,
    reviewId: review.id,
    fingerprint,
    authorityEpoch: permit.authorityEpoch,
    state: "active",
  };
  const consumed: ApprovalRecord = { ...approval, consumedBy: id };
  let guard = `${fence.sql} AND ${frozen.sql} AND ${ready.sql}
    AND ?>${sqlNow} AND ?>${sqlNow}
    AND EXISTS(SELECT 1 FROM office_meta_approvals WHERE owner=? AND id=? AND consumed_by IS NULL AND record=?)
    AND NOT EXISTS(SELECT 1 FROM office_meta_barriers WHERE owner=? AND document=?)
    AND EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=? AND phase NOT IN ('failed-before-submit','cancelled-before-dispatch','conflict'))`;
  const values: (string | number | null)[] = [
    ...fence.values,
    ...frozen.values,
    ...ready.values,
    approval.expiresAt,
    record.actor.expiresAt,
    owner,
    approvalId,
    approvalRow.record,
    owner,
    record.documentId,
    owner,
    approvalId,
  ];
  if (permit.target.scope.kind === "draft") {
    guard +=
      " AND EXISTS(SELECT 1 FROM office_meta_drafts WHERE owner=? AND id=? AND document=? AND worktree=? AND generation=?)";
    values.push(
      owner,
      permit.target.scope.draftId,
      record.documentId,
      review.worktreeId,
      review.generation,
    );
  }
  const statements: Statement[] = [];
  if (previous) {
    guard += ` AND EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=? AND ${operationRecordSql}=? AND claim_worker IS NULL)`;
    values.push(owner, id, db.encode(OperationRow, previous));
    statements.push([
      "UPDATE office_meta_operations SET version=?,phase=?,record=? WHERE owner=? AND id=?",
      [record.receipt.version, record.receipt.phase, db.encode(OperationRow, record), owner, id],
    ]);
  } else {
    guard += " AND NOT EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=?)";
    values.push(owner, id);
    statements.push([
      "INSERT INTO office_meta_operations(owner,id,document,version,phase,created,record) VALUES(?,?,?,?,?,?,?)",
      [
        owner,
        id,
        record.documentId,
        record.receipt.version,
        record.receipt.phase,
        record.createdAt,
        db.encode(OperationRow, record),
      ],
    ]);
  }
  statements.push(
    [
      "UPDATE office_meta_approvals SET consumed_by=?,record=? WHERE owner=? AND id=?",
      [id, db.encode(ApprovalRow, consumed), owner, approvalId],
    ],
    [
      "INSERT INTO office_meta_barriers VALUES(?,?,?,?,?)",
      [owner, record.documentId, id, "active", db.encode(BarrierRow, result)],
    ],
    ...artifactEdges(db, record.owner, "operation", id, refs),
    eventStatement(db, record.owner, operationEvent(record.documentId, id)),
  );
  await db.write(guard, values, statements, "STALE_REVIEW");
  return result;
}
