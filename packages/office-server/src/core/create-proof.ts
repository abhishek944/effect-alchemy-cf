import { Effect } from "effect";
import type {
  NativeTarget,
  OfficeDependencies,
  OperationRecord,
  WritePermit,
} from "../ports/index.ts";
import {
  nativeWrites,
  confirmNativeWrites,
  completeNativeOperation,
  proposedNativeRevision,
} from "./native-complete.ts";
import { observeNativeWrite, originalWriteTarget } from "./write-observation.ts";
import { nativeCall, officeFailure } from "./failure.ts";

export const creationEvidence = Effect.fn("Office.creationEvidence")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
) {
  const writes = yield* nativeWrites(deps, record);
  for (const write of writes) {
    const observed = yield* observeNativeWrite(
      deps,
      record,
      originalWriteTarget(record, write),
      write,
    );
    if (observed.state !== "confirmed")
      return { writes, known: false, complete: false, acceptedRevision: null };
  }
  const newDocument = record.intent.kind === "create";
  const main = newDocument && record.intent.input.destination === "main";
  const group = writes.some(
    (value) =>
      value.receiptKey.kind === "create-worktree" &&
      value.receiptKey.worktreeId === record.worktreeId,
  );
  const content = writes.find((value) =>
    main
      ? value.receiptKey.kind === "create-main"
      : value.receiptKey.kind === "create-draft" &&
        value.receiptKey.worktreeId === record.worktreeId,
  );
  const complete = main ? content !== undefined : group && (!newDocument || content !== undefined);
  const acceptedRevision =
    content === undefined ? null : yield* proposedNativeRevision(deps, record, content);
  return { writes, known: true, complete, acceptedRevision };
});
export const creationHead = Effect.fn("Office.creationHead")(function* (
  deps: OfficeDependencies,
  target: NativeTarget,
  worktreeId: string | null,
) {
  const epoch = yield* deps.authority.current(target.owner, target.documentId);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const pair = yield* deps.native({ kind: "read", target, ...epoch });
      const context = { userID: target.owner.ownerId, customData: {}, request: {} };
      if (target.scope.kind === "main") {
        const unit = yield* nativeCall(() => pair.core.getUnit(context, target.unitId));
        return unit?.headRevision ?? null;
      }
      if (worktreeId === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
      const unit = yield* nativeCall(() =>
        pair.worktrees.getWorktreeUnit(context, worktreeId, target.unitId),
      );
      return unit?.draftHeadRevision ?? null;
    }),
  );
});
export const finishCreation = Effect.fn("Office.finishCreation")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
  permit: WritePermit,
  acceptedRevision: number | null,
) {
  yield* confirmNativeWrites(deps, record, permit);
  if (record.intent.kind === "create" && record.intent.input.destination === "main") {
    // Concrete catalog's initial publication contract is revision 1; never rewrite a native header to fit it.
    if (acceptedRevision !== 1)
      return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", permit.operationId));
    yield* deps.metadata.publishDocument(permit);
  }
  return yield* completeNativeOperation(deps, record, permit, acceptedRevision);
});
