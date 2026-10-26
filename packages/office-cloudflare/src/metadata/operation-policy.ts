import type { OperationRecord } from "@starter/office-server/ports";
import type { OperationPhase } from "@starter/office-contract";
import { canonical, conflict, invalid } from "./store.ts";

const transitions: Readonly<Record<OperationPhase, readonly OperationPhase[]>> = {
  reserved: [
    "input-pinned",
    "queued",
    "admitted",
    "confirmed",
    "failed-before-submit",
    "cancelled-before-dispatch",
  ],
  "input-pinned": ["queued", "admitted", "failed-before-submit", "cancelled-before-dispatch"],
  queued: ["running", "admitted", "failed-before-submit", "cancelled-before-dispatch"],
  running: [
    "proposal-staged",
    "confirmed",
    "failed-before-submit",
    "execution-unknown",
    "cancelled-before-dispatch",
  ],
  "proposal-staged": ["admitted", "conflict", "cancelled-before-dispatch"],
  admitted: ["dispatching", "publishing", "confirmed", "failed-before-submit", "conflict"],
  dispatching: ["submission-unknown", "publishing", "confirmed", "needs-attention", "conflict"],
  "submission-unknown": ["publishing", "confirmed", "needs-attention", "conflict"],
  publishing: ["confirmed", "needs-attention", "conflict"],
  "execution-unknown": ["needs-attention"],
  "needs-attention": ["confirmed", "conflict"],
  confirmed: [],
  "failed-before-submit": [],
  conflict: [],
  "cancelled-before-dispatch": [],
};
export function operationIdentity(record: OperationRecord) {
  return {
    owner: record.owner,
    actor: record.actor,
    documentId: record.documentId,
    unitId: record.unitId,
    worktreeId: record.worktreeId,
    intent: record.intent,
    intentDigest: record.intentDigest,
    lineageDigest: record.lineageDigest,
    policyVersion: record.policyVersion,
    createdAt: record.createdAt,
    operationId: record.receipt.operationId,
    kind: record.receipt.kind,
  };
}
export function validateOperation(record: OperationRecord): void {
  if (
    canonical(record.actor.owner) !== canonical(record.owner) ||
    record.intent.kind !== record.receipt.kind ||
    record.intent.input.operationId !== record.receipt.operationId ||
    record.updatedAt < record.createdAt ||
    (record.receipt.documentId !== null && record.receipt.documentId !== record.documentId) ||
    (record.merge !== null &&
      (record.intent.kind !== "merge" || record.merge.operationId !== record.receipt.operationId))
  )
    throw invalid();
  if (record.intent.kind === "create-draft" && record.intent.input.documentId !== record.documentId)
    throw invalid();
  if (
    record.intent.kind === "execute" &&
    (record.intent.input.target.documentId !== record.documentId ||
      record.worktreeId === null ||
      record.intent.input.target.generation < 1 ||
      (record.artifacts.code !== null && record.artifacts.code.id !== record.intent.input.codeId))
  )
    throw invalid();
  if (
    record.intent.kind === "import-into" &&
    (record.intent.input.target.documentId !== record.documentId ||
      record.worktreeId === null ||
      record.receipt.draftId !== record.intent.input.target.draftId ||
      record.intent.input.target.generation < 1 ||
      record.artifacts.code !== null ||
      (record.artifacts.source !== null &&
        canonical(record.artifacts.source) !== canonical(record.intent.input.source)))
  )
    throw invalid();
  if (
    ["ready", "reopen", "discard", "merge"].includes(record.intent.kind) &&
    record.worktreeId === null
  )
    throw invalid();
}
/** Only the original unstarted draft request may record its initial stale/noneditable result. */
export function initialDraftConflict(previous: OperationRecord, next: OperationRecord): boolean {
  if (
    (previous.intent.kind !== "execute" && previous.intent.kind !== "import-into") ||
    previous.receipt.phase !== "reserved" ||
    next.receipt.phase !== "conflict" ||
    previous.receipt.version !== 0 ||
    next.receipt.version !== 1 ||
    previous.receipt.error !== null
  )
    return false;
  const error = next.receipt.error,
    draftId = previous.intent.input.target.draftId;
  if (
    !error ||
    (error.code !== "STALE_BASIS" && error.code !== "NOT_EDITABLE") ||
    error.operationId !== next.receipt.operationId
  )
    return false;
  return [previous, next].every(
    (record) =>
      record.jobId === null &&
      record.worktreeId !== null &&
      Object.values(record.artifacts).every((ref) => ref === null) &&
      record.receipt.documentId === record.documentId &&
      record.receipt.draftId === draftId &&
      record.receipt.acceptedRevision === null &&
      record.receipt.reviewId === null &&
      record.receipt.artifact === null,
  );
}
export function validateAdvance(
  previous: OperationRecord,
  next: OperationRecord,
  expected: number,
): void {
  validateOperation(next);
  if (canonical(operationIdentity(previous)) !== canonical(operationIdentity(next)))
    throw conflict();
  if (
    next.receipt.version !== expected + 1 ||
    previous.receipt.version !== expected ||
    next.updatedAt < previous.updatedAt
  )
    throw conflict();
  if (
    previous.receipt.phase !== next.receipt.phase &&
    !transitions[previous.receipt.phase].includes(next.receipt.phase) &&
    !initialDraftConflict(previous, next)
  )
    throw conflict("NOT_EDITABLE");
  if (transitions[previous.receipt.phase].length === 0) throw conflict("NOT_EDITABLE");
  for (const key of ["source", "input", "code", "proposal"] as const) {
    if (
      previous.artifacts[key] !== null &&
      canonical(previous.artifacts[key]) !== canonical(next.artifacts[key])
    )
      throw conflict();
  }
  // The merge witness is set at most once; a later advance may carry it but never rewrite it.
  if (previous.merge !== null && canonical(previous.merge) !== canonical(next.merge))
    throw conflict();
  if (previous.receipt.reviewId !== null && next.receipt.reviewId !== previous.receipt.reviewId)
    throw conflict();
  if (previous.jobId !== null && previous.jobId !== next.jobId) throw conflict();
  if (
    previous.receipt.acceptedRevision !== null &&
    (next.receipt.acceptedRevision !== previous.receipt.acceptedRevision ||
      canonical(next.receipt.artifact) !== canonical(previous.receipt.artifact))
  )
    throw conflict("OUTCOME_UNKNOWN");
}
