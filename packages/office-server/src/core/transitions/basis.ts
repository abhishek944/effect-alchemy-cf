import { Effect } from "effect";
import { decodeWire } from "@starter/office-contract";
import type { NativeWriteRecord, OfficeDependencies, OperationRecord } from "../../ports/index.ts";
import { sameOwner } from "../claims.ts";
import { operationTarget } from "../operation-caller.ts";
import { nativeWrites } from "../native-complete.ts";
import { observeNativeWrite, originalWriteTarget } from "../write-observation.ts";
import { StoredDocument, StoredDraft } from "../record-schemas.ts";
import { nativeTypes } from "../target.ts";
import { officeFailure } from "../failure.ts";

export const transitionBasis = Effect.fn("Office.transitions.basis")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
) {
  const intent = record.intent;
  if ((intent.kind !== "reopen" && intent.kind !== "discard") || record.worktreeId === null)
    return yield* Effect.fail(officeFailure("INVALID_INPUT", record.receipt.operationId));
  const target = yield* operationTarget(deps, record);
  if (target.scope.kind !== "draft" || record.receipt.draftId !== intent.input.draftId)
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  const draft = yield* decodeWire(StoredDraft)(
    yield* deps.metadata.draft(record.owner, intent.input.draftId),
  ).pipe(Effect.mapError(() => officeFailure("CONTENT_REQUIRED", record.receipt.operationId)));
  const document = yield* decodeWire(StoredDocument)(
    yield* deps.metadata.document(record.owner, record.documentId),
  ).pipe(Effect.mapError(() => officeFailure("CONTENT_REQUIRED", record.receipt.operationId)));
  if (
    !sameOwner(draft.owner, record.owner) ||
    !sameOwner(document.owner, record.owner) ||
    draft.id !== intent.input.draftId ||
    draft.documentId !== record.documentId ||
    draft.worktreeId !== record.worktreeId ||
    document.document.id !== record.documentId ||
    document.unitId !== record.unitId ||
    draft.generation < intent.input.generation
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  return {
    kind: intent.kind,
    generation: intent.input.generation,
    draft,
    document,
    worktreeId: record.worktreeId,
    target: { ...target, scope: target.scope },
  };
});
export type TransitionBasis = Effect.Success<ReturnType<typeof transitionBasis>>;

export const transitionEvidence = Effect.fn("Office.transitions.evidence")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
  basis: TransitionBasis,
) {
  const writes = yield* nativeWrites(deps, record);
  if (writes.length === 0) return null;
  const write: NativeWriteRecord | undefined = writes[0];
  if (
    writes.length !== 1 ||
    write === undefined ||
    write.kind !== "lifecycle" ||
    write.worktreeId !== basis.worktreeId ||
    write.generation !== basis.generation ||
    String(write.nativeType) !== String(nativeTypes[basis.document.document.kind]) ||
    write.baseRevision === null ||
    write.receiptKey.kind !== "transition" ||
    write.receiptKey.worktreeId !== basis.worktreeId ||
    write.receiptKey.generation !== basis.generation ||
    write.receiptKey.target !== (basis.kind === "reopen" ? "draft" : "discarded")
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  const proof = yield* observeNativeWrite(deps, record, originalWriteTarget(record, write), write);
  return { write, confirmed: proof.state === "confirmed" };
});
