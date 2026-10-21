import { Clock, Effect, type Scope } from "effect";
import { decodeWire } from "@starter/office-contract";
import type {
  NativeWriteRecord,
  OfficeDependencies,
  OperationRecord,
  WritePermit,
} from "../ports/index.ts";
import { NativeReceiptKey } from "../ports/index.ts";
import type { NativeJournal, NativeStep } from "./native-lease.ts";
import { nativeReceiptKey, nativeWriteHeader } from "./native-key.ts";
import { stageNativeArtifact } from "./bytes.ts";
import { advanceOperation, boundedMetadataDigest, terminalReceipt } from "./operations.ts";
import { verifyOperation } from "./claims.ts";
import { officeFailure } from "./failure.ts";
import { StoredOperation } from "./record-schemas.ts";
import { checkNativeIntent } from "./native-policy.ts";
import { findNativeWrite, observeNativeWrite } from "./write-observation.ts";

const beforeStep = Effect.fn("Office.beforeNativeStep")(function* (
  deps: OfficeDependencies,
  operation: OperationRecord,
  permit: WritePermit,
  nativeType: number,
  step: NativeStep,
  phase: "final-commit" | "recovery-dispatch",
) {
  yield* verifyOperation(deps, operation, permit.target, phase);
  if (operation.intent.kind === "merge") {
    const approval = yield* deps.metadata.approval(
      operation.owner,
      operation.intent.input.approvalOperationId,
    );
    if (
      approval === null ||
      approval.consumedBy !== permit.operationId ||
      approval.fingerprint !== permit.reviewFingerprint ||
      approval.expiresAt <= (yield* Clock.currentTimeMillis)
    )
      return yield* Effect.fail(officeFailure("STALE_REVIEW", permit.operationId));
  }
  yield* Effect.try({
    try: () => checkNativeIntent(operation, step),
    catch: () => officeFailure("FORBIDDEN", permit.operationId),
  });
  if (operation.receipt.operationId !== permit.operationId)
    return yield* Effect.fail(officeFailure("FORBIDDEN", permit.operationId));
  const receiptKey = yield* decodeWire(NativeReceiptKey)(nativeReceiptKey(step, permit)).pipe(
    Effect.mapError(() => officeFailure("INVALID_INPUT", permit.operationId)),
  );
  const id = yield* boundedMetadataDigest({ stepId: permit.stepId, receiptKey }, 4096);
  if (yield* findNativeWrite(deps, operation.owner, permit.operationId, id))
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", permit.operationId));
  const currentValue = yield* deps.metadata.operation(operation.owner, permit.operationId);
  if (currentValue === null)
    return yield* Effect.fail(officeFailure("NOT_FOUND", permit.operationId));
  const current = yield* decodeWire(StoredOperation)(currentValue).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED", permit.operationId)),
  );
  if (
    terminalReceipt(current.receipt.phase) ||
    current.intentDigest !== operation.intentDigest ||
    current.lineageDigest !== operation.lineageDigest
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", permit.operationId));
  if (
    (current.intent.kind === "execute" || current.intent.kind === "import-into") &&
    current.artifacts.proposal === null
  )
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", permit.operationId));
  // Full SDK values stay ONLY in a binary native artifact, never metadataDigest/JSON/receipts.
  const payload = yield* stageNativeArtifact(deps, operation.owner, "native-write", "proposal", {
    version: 1,
    operationId: permit.operationId,
    stepId: permit.stepId,
    target: permit.target,
    intentDigest: current.intentDigest,
    lineageDigest: current.lineageDigest,
    receiptKey,
    step,
  });
  const header = nativeWriteHeader(step, permit, nativeType);
  const write: NativeWriteRecord = {
    id,
    stepId: permit.stepId,
    operationId: permit.operationId,
    documentId: permit.documentId,
    unitId: permit.target.unitId,
    worktreeId: "worktreeId" in receiptKey ? receiptKey.worktreeId : null,
    generation: permit.target.scope.kind === "draft" ? permit.target.scope.generation : null,
    ...header,
    receiptKey,
    preparedReceipt: null,
    payload,
    phase: "staged",
    acceptedRevision: null,
  };
  yield* deps.metadata.stageWrite(permit, write);
  if (current.receipt.phase !== "dispatching") {
    const recovering = ["submission-unknown", "publishing", "needs-attention"].includes(
      current.receipt.phase,
    );
    if (recovering && !(operation.intent.kind === "merge" && phase === "recovery-dispatch"))
      return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", permit.operationId));
    yield* advanceOperation(deps, current, recovering ? current.receipt.phase : "dispatching");
  }
  return write;
});
const contentRevision = (step: NativeStep): number | null => {
  switch (step.kind) {
    case "core-commit":
    case "draft-commit":
      return step.input.changeset.revision;
    case "core-create":
    case "core-snapshot":
      return step.input.snapshot.rev;
    case "draft-create":
      return step.input.seed.snapshot.rev;
    default:
      return null;
  }
};
const noPublicationStatuses = new Set([
  "revision-mismatch",
  "not-editable",
  "unit-frozen",
  "not-found",
  "status-mismatch",
  "unit-exists",
  "stale-merge",
  "already-exists",
  "already-created",
  "already-saved",
  "already-in-target",
  "already-merged",
  "already-recorded",
  "unchanged",
  "resumed",
]);
const noPublicationResult = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "status" in value &&
  typeof value.status === "string" &&
  noPublicationStatuses.has(value.status);
/** Explicit Effect -> SDK Promise interop in the caller's scope; never creates a hidden runtime/provider. */
export const makeNativeJournal = Effect.fn("Office.makeNativeJournal")(function* (
  deps: OfficeDependencies,
  operation: OperationRecord,
  permit: WritePermit,
  nativeType: number,
  phase: "final-commit" | "recovery-dispatch" = "final-commit",
) {
  const context = yield* Effect.context<Scope.Scope>();
  const run = Effect.runPromiseWith(context);
  const journal: NativeJournal = async (step, dispatch) => {
    const write = await run(beforeStep(deps, operation, permit, nativeType, step, phase));
    const result = await dispatch();
    await run(
      Effect.gen(function* () {
        const prepared = yield* findNativeWrite(
          deps,
          operation.owner,
          permit.operationId,
          write.id,
        );
        if (
          prepared === null ||
          prepared.payload.digest !== write.payload.digest ||
          prepared.stepId !== write.stepId
        )
          return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", permit.operationId));
        const observed = yield* observeNativeWrite(deps, operation, permit.target, prepared);
        if (observed.state === "confirmed")
          yield* deps.metadata.confirmWrite(permit, write.id, contentRevision(step));
        else if (!noPublicationResult(result))
          return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", permit.operationId));
        return undefined;
      }),
    );
    return result;
  };
  return journal;
});
