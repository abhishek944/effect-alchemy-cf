import { Effect } from "effect";
import { safeFailure } from "@starter/office-contract";
import { NATIVE_WIRE_CODEC } from "@starter/office-contract/native-wire";
import type { NativeProposalFrame, OfficeDependencies, OperationRecord } from "../ports/index.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";
import { makeNativeJournal } from "./native-journal.ts";
import { verifyOperation } from "./claims.ts";
import { advanceOperation, terminalReceipt } from "./operations.ts";
import { operationRecord } from "./operation-read.ts";
import {
  completeNativeOperation,
  nativeWrites,
  retainNativeUncertainty,
} from "./native-complete.ts";
import { nativeFailure, officeFailure } from "./failure.ts";

export const commitExecution = Effect.fn("Office.commitExecution")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  original: OperationRecord,
  proposal: NativeProposalFrame,
  phase: "final-commit" | "recovery-dispatch" = "final-commit",
) {
  if (
    (original.intent.kind !== "execute" && original.intent.kind !== "import-into") ||
    original.worktreeId === null
  )
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", original.receipt.operationId));
  const input = original.intent.input;
  const target = {
    owner: original.owner,
    documentId: original.documentId,
    unitId: original.unitId,
    scope: {
      kind: "draft" as const,
      draftId: input.target.draftId,
      generation: input.target.generation,
    },
  };
  if (
    proposal.binding.policyVersion !== deps.policy.version ||
    proposal.binding.imageDigest !== deps.policy.imageDigest ||
    proposal.binding.codec !== NATIVE_WIRE_CODEC
  )
    return yield* Effect.fail(officeFailure("NOT_EDITABLE", input.operationId));
  const worktreeId = original.worktreeId;
  return yield* deps.authority
    .serial(
      target,
      {
        operationId: input.operationId,
        expectedHead: input.target.expectedRevision,
        reviewFingerprint: null,
        purpose: "native",
      },
      (permit) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* verifyOperation(deps, original, target, phase);
            const current = yield* operationRecord(deps, original.owner, input.operationId);
            if (current === null)
              return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", input.operationId));
            if (terminalReceipt(current.receipt.phase)) return current.receipt;
            const writes = yield* nativeWrites(deps, current);
            if (writes.length > 0 || current.receipt.phase !== "proposal-staged")
              return yield* retainNativeUncertainty(deps, current);
            const admitted = yield* advanceOperation(deps, current, "admitted");
            if (proposal.changeset.mutations.length === 0) {
              const complete = yield* advanceOperation(
                deps,
                admitted,
                "confirmed",
                {},
                { acceptedRevision: null, error: null },
              );
              return complete.receipt;
            }
            const journal = yield* makeNativeJournal(
              deps,
              admitted,
              permit,
              proposal.changeset.type,
              phase,
            );
            const result = yield* runtime.invoke(
              { kind: "write", permit },
              worktreeId,
              "draft",
              journal,
              (services) =>
                services.drafts.submitChangeset(
                  { worktreeID: worktreeId, changeset: proposal.changeset },
                  {
                    userID: original.owner.ownerId,
                    memberID: proposal.changeset.memberID,
                  },
                ),
            );
            if (result.status === "rejected" || result.status === "retry")
              return yield* Effect.fail(nativeFailure(result.error));
            if (
              result.changeset.revision !== proposal.changeset.revision ||
              result.changeset.baseRev !== proposal.changeset.baseRev
            )
              return yield* Effect.fail(officeFailure("STALE_BASIS", input.operationId));
            return yield* completeNativeOperation(
              deps,
              admitted,
              permit,
              result.changeset.revision,
            );
          }),
        ),
    )
    .pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const current = yield* operationRecord(deps, original.owner, input.operationId);
          if (current === null) return yield* Effect.fail(error);
          if (terminalReceipt(current.receipt.phase)) return current.receipt;
          const writes = yield* nativeWrites(deps, current);
          if (
            writes.length > 0 ||
            current.receipt.phase === "admitted" ||
            current.receipt.phase === "dispatching"
          )
            return yield* retainNativeUncertainty(deps, current);
          if (
            error.code === "STALE_BASIS" ||
            error.code === "NOT_EDITABLE" ||
            error.code === "AUTHORITY_LOST"
          ) {
            const failed = yield* advanceOperation(
              deps,
              current,
              "conflict",
              {},
              { error: safeFailure(error.code, input.operationId) },
            );
            return failed.receipt;
          }
          return yield* Effect.fail(error);
        }),
      ),
    );
});
