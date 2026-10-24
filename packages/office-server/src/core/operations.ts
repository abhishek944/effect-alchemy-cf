import { Clock, Effect } from "effect";
import { decodeWire, type OperationPhase } from "@starter/office-contract";
import type {
  ActorClaims,
  DocumentRecord,
  DraftRecord,
  OfficeDependencies,
  OperationIntent,
  OperationRecord,
} from "../ports/index.ts";
import { officeFailure } from "./failure.ts";

import { StoredOperation } from "./record-schemas.ts";
import { actorIdentity, boundedMetadataDigest } from "./control-identity.ts";
export { sha256, metadataDigest, boundedMetadataDigest } from "./control-identity.ts";
import { createOperationRecord } from "./operation-create.ts";
import { prepareOperation } from "./operation-prepare.ts";
export const reserveOperation = Effect.fn("Office.reserveOperation")(function* (
  deps: OfficeDependencies,
  actor: ActorClaims,
  intentValue: OperationIntent,
  document: DocumentRecord,
  draft: DraftRecord | null,
) {
  const prepared = yield* prepareOperation(deps, actor, intentValue, document, draft);
  const { intent, intentDigest, lineageDigest } = prepared;
  // Capability/idempotency restriction is prepared; this is reserve's own fresh-basis rule.
  if (
    actor.capability === "draft-task" &&
    (intent.kind === "execute" || intent.kind === "import-into") &&
    actor.target?.expectedRevision !== intent.input.target.expectedRevision
  )
    return yield* Effect.fail(officeFailure("STALE_BASIS", intent.input.operationId));
  const accept = (raw: unknown) =>
    Effect.gen(function* () {
      const accepted = yield* decodeWire(StoredOperation)(raw).pipe(
        Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
      );
      const savedLineage = yield* boundedMetadataDigest(
        actorIdentity(accepted.actor),
        deps.policy.limits.metadataBytes,
      );
      if (
        accepted.intentDigest !== intentDigest ||
        accepted.lineageDigest !== lineageDigest ||
        savedLineage !== lineageDigest ||
        accepted.unitId !== document.unitId ||
        accepted.documentId !== document.document.id ||
        accepted.worktreeId !== (draft?.worktreeId ?? null) ||
        accepted.policyVersion !== deps.policy.version ||
        accepted.receipt.operationId !== intent.input.operationId ||
        accepted.owner.stage !== actor.owner.stage ||
        accepted.owner.ownerId !== actor.owner.ownerId
      )
        return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", intent.input.operationId));
      return accepted;
    });
  const previous = yield* deps.metadata.operation(actor.owner, intent.input.operationId);
  if (previous !== null) return yield* accept(previous);
  const normalized = yield* createOperationRecord(deps, actor, prepared, document, draft);
  const acceptedRaw = yield* deps.metadata.reserveOperation(normalized).pipe(
    Effect.catch((error) => {
      if (error.code !== "IDEMPOTENCY_CONFLICT" && error.code !== "NATIVE_CONFLICT")
        return Effect.fail(error);
      return deps.metadata
        .operation(actor.owner, intent.input.operationId)
        .pipe(Effect.flatMap((winner) => (winner === null ? Effect.fail(error) : accept(winner))));
    }),
  );
  return yield* accept(acceptedRaw);
});
export const advanceOperation = Effect.fn("Office.advanceOperation")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
  phase: OperationPhase,
  update: Partial<Pick<OperationRecord, "artifacts" | "jobId" | "merge">> = {},
  receiptUpdate: Partial<
    Pick<OperationRecord["receipt"], "artifact" | "acceptedRevision" | "reviewId" | "error">
  > = {},
) {
  if (record.receipt.phase === "confirmed" && phase !== "confirmed")
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  const now = yield* Clock.currentTimeMillis;
  const next = {
    ...record,
    ...update,
    updatedAt: now,
    receipt: { ...record.receipt, ...receiptUpdate, phase, version: record.receipt.version + 1 },
  };
  const normalized = yield* decodeWire(StoredOperation)(next).pipe(
    Effect.mapError(() => officeFailure("INVALID_INPUT")),
  );
  yield* boundedMetadataDigest(normalized, deps.policy.limits.metadataBytes);
  return yield* deps.metadata.advanceOperation(normalized, record.receipt.version);
});
export const terminalReceipt = (phase: OperationPhase): boolean =>
  phase === "confirmed" ||
  phase === "failed-before-submit" ||
  phase === "conflict" ||
  phase === "cancelled-before-dispatch";
