import { Effect, type Scope } from "effect";
import { safeFailure, type OfficeError } from "@starter/office-contract";
import type { OfficeDependencies, OperationRecord } from "../../ports/index.ts";
import type { OfficeNativeRuntime } from "../native-runtime.ts";
import { verifyOperation } from "../claims.ts";
import { operationTarget } from "../operation-caller.ts";
import { operationRecord } from "../operation-read.ts";
import { creationHead } from "../create-proof.ts";
import { advanceOperation, terminalReceipt } from "../operations.ts";
import { nativeWrites, retainNativeUncertainty } from "../native-complete.ts";
import { makeNativeJournal } from "../native-journal.ts";
import { nativeTypes } from "../target.ts";
import { officeFailure } from "../failure.ts";
import { transitionBasis, transitionEvidence } from "./basis.ts";
import { finishTransition } from "./finish.ts";

export const progressTransition = Effect.fn("Office.transitions.progress")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  original: OperationRecord,
  phase: "final-commit" | "recovery-dispatch" | "recovery-observe",
) {
  const target = yield* operationTarget(deps, original);
  yield* verifyOperation(deps, original, target, "recovery-observe");
  if (terminalReceipt(original.receipt.phase)) return original.receipt;
  const basis = yield* transitionBasis(deps, original);
  // Observe before any old-generation read. Existing attempts never enter the SDK again.
  const evidence = yield* transitionEvidence(deps, original, basis);
  if (evidence !== null && !evidence.confirmed)
    return yield* retainNativeUncertainty(deps, original);
  if (evidence === null && !["reserved", "queued", "admitted"].includes(original.receipt.phase))
    return yield* retainNativeUncertainty(deps, original);
  if (evidence === null) {
    if (phase === "recovery-observe") return original.receipt;
    if (basis.draft.generation !== basis.generation)
      return yield* Effect.fail(officeFailure("STALE_BASIS", original.receipt.operationId));
    yield* verifyOperation(deps, original, target, phase);
  }
  // A proof-only turn retains saved permit identity; it does not preflight the current head.
  const expectedHead =
    evidence === null
      ? yield* creationHead(deps, target, basis.worktreeId)
      : evidence.write.baseRevision;
  return yield* deps.authority.serial(
    target,
    {
      operationId: original.receipt.operationId,
      expectedHead,
      reviewFingerprint: null,
      purpose: evidence === null ? "native" : "proof",
    },
    (permit) =>
      Effect.scoped(
        Effect.gen(function* () {
          const current = yield* operationRecord(
            deps,
            original.owner,
            original.receipt.operationId,
          );
          if (current === null)
            return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", permit.operationId));
          if (terminalReceipt(current.receipt.phase)) return current.receipt;
          const actual = yield* transitionBasis(deps, current);
          const saved = yield* transitionEvidence(deps, current, actual);
          if (saved !== null) {
            if (!saved.confirmed) return yield* retainNativeUncertainty(deps, current);
            // Metadata-only repair under the original target: no stale native acquisition.
            return yield* finishTransition(deps, current, permit);
          }
          if (
            phase === "recovery-observe" ||
            evidence !== null ||
            actual.draft.generation !== actual.generation ||
            !["reserved", "queued", "admitted"].includes(current.receipt.phase)
          )
            return yield* retainNativeUncertainty(deps, current);
          if (actual.kind === "reopen" && actual.generation === Number.MAX_SAFE_INTEGER)
            return yield* Effect.fail(officeFailure("LIMIT_EXCEEDED", permit.operationId));
          if (current.policyVersion !== deps.policy.version)
            return yield* Effect.fail(officeFailure("EXECUTOR_UNCONFIGURED", permit.operationId));
          yield* verifyOperation(deps, current, target, phase);
          // This is a quiescence precheck; atomic editor admission remains T22's obligation.
          const editors = yield* deps.metadata.editors(current.owner, current.documentId);
          if (editors.some((editor) => ["active", "draining", "unclean"].includes(editor.state)))
            return yield* Effect.fail(officeFailure("BUSY", permit.operationId));
          const journal = yield* makeNativeJournal(
            deps,
            current,
            permit,
            nativeTypes[actual.document.document.kind],
            phase,
          );
          const effectContext = yield* Effect.context<Scope.Scope>();
          const run = Effect.runPromiseWith(effectContext);
          const admitted = current;
          const result = yield* runtime.invoke(
            { kind: "write", permit },
            actual.worktreeId,
            "lifecycle",
            journal,
            async (services) => {
              const context = { userID: admitted.owner.ownerId };
              const before = await services.drafts.getWorktree(
                { worktreeID: actual.worktreeId },
                context,
              );
              const unit = before.worktree.units[0];
              if (
                before.worktree.worktreeID !== actual.worktreeId ||
                before.worktree.units.length !== 1 ||
                unit?.unitID !== admitted.unitId ||
                unit.type !== nativeTypes[actual.document.document.kind] ||
                unit.draftHeadRevision !== permit.expectedHead
              )
                throw officeFailure("STALE_BASIS", permit.operationId);
              if (
                actual.kind === "reopen"
                  ? before.worktree.status !== "ready"
                  : !["draft", "ready"].includes(before.worktree.status)
              )
                throw officeFailure("NOT_EDITABLE", permit.operationId);
              if (admitted.receipt.phase !== "admitted")
                await run(advanceOperation(deps, admitted, "admitted"));
              return actual.kind === "reopen"
                ? services.drafts.reopenWorktree({ worktreeID: actual.worktreeId }, context)
                : services.drafts.discardWorktree({ worktreeID: actual.worktreeId }, context);
            },
          );
          if (
            result.worktree.worktreeID !== actual.worktreeId ||
            result.worktree.status !== (actual.kind === "reopen" ? "draft" : "discarded") ||
            result.worktree.units.length !== 1 ||
            result.worktree.units[0]?.unitID !== current.unitId
          )
            return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", permit.operationId));
          const updated = yield* operationRecord(deps, original.owner, permit.operationId);
          if (updated === null)
            return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", permit.operationId));
          return yield* finishTransition(deps, updated, permit);
        }),
      ),
  );
});

export const transitionFailure = Effect.fn("Office.transitions.failure")(function* (
  deps: OfficeDependencies,
  original: OperationRecord,
  error: OfficeError,
) {
  const current = yield* operationRecord(deps, original.owner, original.receipt.operationId);
  if (current === null)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", original.receipt.operationId));
  if (terminalReceipt(current.receipt.phase)) return current.receipt;
  if ((yield* nativeWrites(deps, current)).length > 0)
    return yield* retainNativeUncertainty(deps, current);
  if (current.receipt.phase === "admitted")
    return (yield* advanceOperation(
      deps,
      current,
      "failed-before-submit",
      {},
      {
        error: safeFailure(error.code, current.receipt.operationId),
      },
    )).receipt;
  return null;
});
