import type { NativeTarget, SerialAdmission } from "@starter/office-server/ports";
import type { MetadataStore } from "../store.ts";
import type { PredicateSQL } from "../native-fence.ts";
import { canonical, conflict, sqlNow } from "../store.ts";
import { operationRow } from "../operations.ts";
import { ApprovalRow, ReviewRow, OperationRow } from "../schemas.ts";
import { requireOriginalTarget } from "./original-target.ts";
import { continuation } from "./continuations.ts";
import type { Turn, VerifiedCoordinatorContext } from "./types.ts";

export type PurposePlan = {
  nativePlan: Turn["nativePlan"];
  authUntil: number;
  predicate: PredicateSQL;
};
export async function validatePurpose(
  db: MetadataStore,
  context: Extract<VerifiedCoordinatorContext, { kind: "core" }>,
  target: NativeTarget,
  request: SerialAdmission,
): Promise<PurposePlan> {
  if (
    context.purpose !== request.purpose ||
    context.binding.operationId !== request.operationId ||
    canonical(context.target) !== canonical(target)
  )
    throw conflict("FORBIDDEN");
  const owner = db.owner(target.owner),
    operation = await operationRow(db, target.owner, request.operationId);
  if (!operation) return provisionalMerge(db, context, target, request);
  await requireOriginalTarget(db, operation, target);
  if (
    context.binding.kind !== "operation" ||
    context.binding.intentDigest !== operation.intentDigest ||
    context.binding.lineageDigest !== operation.lineageDigest
  )
    throw conflict("FORBIDDEN");
  const predicate: PredicateSQL = {
    sql: "EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=? AND record=?)",
    values: [owner, request.operationId, db.encode(OperationRow, operation)],
  };
  const base: PurposePlan = { nativePlan: null, authUntil: context.notAfter, predicate };
  if (request.purpose === "metadata") {
    if (
      operation.intent.kind === "render" ||
      operation.intent.kind === "export" ||
      ((operation.intent.kind === "execute" || operation.intent.kind === "import-into") &&
        operation.receipt.phase === "reserved" &&
        operation.jobId === null)
    )
      return base;
    throw conflict("NOT_EDITABLE");
  }
  if (request.purpose === "proof") {
    const write = await db.first(
      "SELECT 1 FROM office_meta_writes WHERE owner=? AND operation=? LIMIT 1",
      [owner, request.operationId],
    );
    const capturedReady =
      operation.intent.kind === "ready" && operation.artifacts.proposal !== null;
    if (!write && !capturedReady && operation.intent.kind !== "merge")
      throw conflict("OUTCOME_UNKNOWN");
    return base;
  }
  if (
    operation.intent.kind === "render" ||
    operation.intent.kind === "export" ||
    operation.intent.kind === "approve"
  )
    throw conflict("NOT_EDITABLE");
  if (
    operation.intent.kind === "import-into" &&
    request.expectedHead !== operation.intent.input.target.expectedRevision
  )
    throw conflict("STALE_BASIS");
  const next = await continuation(db, operation, request);
  const authUntil = Math.min(context.notAfter, operation.actor.expiresAt);
  if (next)
    return {
      nativePlan: next.nativePlan,
      authUntil,
      predicate: {
        sql: `(${predicate.sql}) AND (${next.predicate.sql})`,
        values: [...predicate.values, ...next.predicate.values],
      },
    };
  const allowed =
    operation.intent.kind === "execute" || operation.intent.kind === "import-into"
      ? ["proposal-staged", "admitted"]
      : operation.intent.kind === "ready" ||
          operation.intent.kind === "reopen" ||
          operation.intent.kind === "discard"
        ? ["reserved", "queued", "admitted"]
        : operation.intent.kind === "merge"
          ? ["admitted"]
          : ["reserved", "proposal-staged", "admitted"];
  if (
    !allowed.includes(operation.receipt.phase) ||
    ((operation.intent.kind === "execute" || operation.intent.kind === "import-into") &&
      operation.artifacts.proposal === null)
  )
    throw conflict("OUTCOME_UNKNOWN");
  return {
    ...base,
    nativePlan: "fresh",
    authUntil,
    predicate: {
      sql: `(${predicate.sql}) AND NOT EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND operation=?)`,
      values: [...predicate.values, owner, request.operationId],
    },
  };
}
async function provisionalMerge(
  db: MetadataStore,
  context: Extract<VerifiedCoordinatorContext, { kind: "core" }>,
  target: NativeTarget,
  request: SerialAdmission,
): Promise<PurposePlan> {
  const origin = context.binding;
  if (
    origin.kind !== "new-merge" ||
    request.purpose !== "native" ||
    target.scope.kind !== "draft" ||
    request.reviewFingerprint !== origin.reviewFingerprint
  )
    throw conflict("CONTENT_REQUIRED");
  const owner = db.owner(target.owner);
  const a = await db.first<{ record: string }>(
    "SELECT record FROM office_meta_approvals WHERE owner=? AND id=?",
    [owner, origin.approvalOperationId],
  );
  const approval = a ? db.decode(ApprovalRow, a.record) : null;
  const r = approval
    ? await db.first<{ record: string }>(
        "SELECT record FROM office_meta_reviews WHERE owner=? AND id=?",
        [owner, approval.reviewId],
      )
    : null;
  const review = r ? db.decode(ReviewRow, r.record) : null;
  if (
    !approval ||
    !review ||
    approval.consumedBy !== null ||
    approval.fingerprint !== origin.reviewFingerprint ||
    approval.humanPrincipalId !== origin.principalId ||
    approval.sessionEpoch !== origin.sessionEpoch ||
    review.documentId !== target.documentId ||
    review.unitId !== target.unitId ||
    review.generation !== target.scope.generation ||
    review.draftRevision !== request.expectedHead
  )
    throw conflict("STALE_REVIEW");
  return {
    nativePlan: "fresh",
    authUntil: Math.min(context.notAfter, approval.expiresAt),
    predicate: {
      sql: `NOT EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=?)
      AND NOT EXISTS(SELECT 1 FROM office_meta_barriers WHERE owner=? AND document=?)
      AND EXISTS(SELECT 1 FROM office_meta_approvals WHERE owner=? AND id=? AND record=? AND consumed_by IS NULL)
      AND EXISTS(SELECT 1 FROM office_meta_reviews WHERE owner=? AND id=? AND record=? AND expires>${sqlNow})
      AND EXISTS(SELECT 1 FROM office_meta_drafts WHERE owner=? AND id=? AND document=? AND worktree=? AND generation=?)`,
      values: [
        owner,
        request.operationId,
        owner,
        target.documentId,
        owner,
        origin.approvalOperationId,
        db.encode(ApprovalRow, approval),
        owner,
        review.id,
        db.encode(ReviewRow, review),
        owner,
        target.scope.draftId,
        target.documentId,
        review.worktreeId,
        review.generation,
      ],
    },
  };
}
