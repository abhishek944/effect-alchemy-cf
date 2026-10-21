import { Effect, type Scope } from "effect";
import { Revision, decodeWire } from "@starter/office-contract";
import type { OfficeDependencies, OperationRecord } from "../ports/index.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";
import { verifyOperation } from "./claims.ts";
import { operationTarget } from "./operation-caller.ts";
import { operationRecord } from "./operation-read.ts";
import { creationHead } from "./create-proof.ts";
import { advanceOperation, terminalReceipt } from "./operations.ts";
import { nativeWrites, retainNativeUncertainty } from "./native-complete.ts";
import { observeNativeWrite, originalWriteTarget } from "./write-observation.ts";
import { captureReady } from "./ready-capture.ts";
import { publishReadyReview } from "./freeze-ready.ts";
import { makeNativeJournal } from "./native-journal.ts";
import { nativeTypes } from "./target.ts";
import { officeFailure } from "./failure.ts";

const readyEvidence = Effect.fn("Office.readyEvidence")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
) {
  if (record.intent.kind !== "ready" || record.worktreeId === null)
    return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  const writes = yield* nativeWrites(deps, record);
  for (const write of writes) {
    const proof = yield* observeNativeWrite(
      deps,
      record,
      originalWriteTarget(record, write),
      write,
    );
    if (proof.state !== "confirmed")
      return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", record.receipt.operationId));
  }
  const generation = record.intent.input.generation,
    worktree = record.worktreeId;
  const marks = writes.filter(
    (write) =>
      write.kind === "lifecycle" &&
      write.worktreeId === worktree &&
      write.generation === generation &&
      write.receiptKey.kind === "transition" &&
      write.receiptKey.target === "ready" &&
      write.receiptKey.worktreeId === worktree &&
      write.receiptKey.generation === generation,
  );
  if (marks.length > 1 || (marks.length === 0 && writes.length > 0))
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", record.receipt.operationId));
  return marks[0] === undefined
    ? null
    : yield* decodeWire(Revision)(marks[0].baseRevision).pipe(
        Effect.mapError(() => officeFailure("CONTENT_REQUIRED", record.receipt.operationId)),
      );
});
export const prepareReady = Effect.fn("Office.prepareReady")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  original: OperationRecord,
  submit: boolean,
  phase: "final-commit" | "recovery-dispatch",
) {
  if (original.intent.kind !== "ready" || original.worktreeId === null)
    return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  if (terminalReceipt(original.receipt.phase)) return original;
  const worktreeID = original.worktreeId;
  const target = yield* operationTarget(deps, original);
  yield* verifyOperation(deps, original, target, "recovery-observe");
  // New publication records reviewId + confirmed atomically; partial legacy markers are ambiguous.
  if (!submit || original.receipt.reviewId !== null || original.artifacts.proposal !== null)
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", original.receipt.operationId));
  if (original.policyVersion !== deps.policy.version)
    return yield* Effect.fail(officeFailure("EXECUTOR_UNCONFIGURED", original.receipt.operationId));
  yield* readyEvidence(deps, original);
  yield* verifyOperation(deps, original, target, phase);
  const head = yield* creationHead(deps, target, original.worktreeId);
  return yield* deps.authority.serial(
    target,
    {
      operationId: original.receipt.operationId,
      expectedHead: head,
      reviewFingerprint: null,
      purpose: "native",
    },
    (permit) =>
      Effect.scoped(
        Effect.gen(function* () {
          let record = yield* operationRecord(deps, original.owner, original.receipt.operationId);
          if (record === null || record.intent.kind !== "ready" || record.worktreeId !== worktreeID)
            return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
          if (terminalReceipt(record.receipt.phase)) return record;
          yield* verifyOperation(deps, record, target, phase);
          if (record.receipt.reviewId !== null || record.artifacts.proposal !== null)
            return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", permit.operationId));
          if (record.policyVersion !== deps.policy.version)
            return yield* Effect.fail(officeFailure("EXECUTOR_UNCONFIGURED", permit.operationId));
          const ready = yield* readyEvidence(deps, record);
          if (ready !== null && ready !== head)
            return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", permit.operationId));
          const editors = yield* deps.metadata.editors(record.owner, record.documentId);
          if (editors.some((editor) => ["active", "draining", "unclean"].includes(editor.state)))
            return yield* Effect.fail(officeFailure("BUSY", permit.operationId));
          if (record.receipt.phase === "reserved")
            record = yield* advanceOperation(deps, record, "admitted");
          const document = yield* deps.metadata.document(record.owner, record.documentId);
          if (document === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
          const journal = yield* makeNativeJournal(
            deps,
            record,
            permit,
            nativeTypes[document.document.kind],
            phase,
          );
          const context = yield* Effect.context<Scope.Scope>();
          const run = Effect.runPromiseWith(context),
            admitted = record;
          return yield* runtime.invoke(
            { kind: "write", permit },
            worktreeID,
            "lifecycle",
            journal,
            async (services) => {
              if (ready === null)
                await services.drafts.markReady({ worktreeID }, { userID: admitted.owner.ownerId });
              const capture = await run(captureReady(deps, services, admitted, permit));
              return run(publishReadyReview(deps, admitted, permit, capture, phase));
            },
          );
        }),
      ),
  );
});
export const readyFailure = Effect.fn("Office.readyFailure")(function* (
  deps: OfficeDependencies,
  original: OperationRecord,
) {
  const record = yield* operationRecord(deps, original.owner, original.receipt.operationId);
  if (record === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  return yield* retainNativeUncertainty(deps, record);
});
