import { Effect } from "effect";
import { decodeWire } from "@starter/office-contract";
import type {
  CreateUnitFromDataInput,
  ISnapshotWithBlocks,
} from "@univerjs-pro/collaboration-service";
import type { OfficeDependencies, OperationRecord } from "../ports/index.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";
import { verifyOperation } from "./claims.ts";
import { operationTarget } from "./operation-caller.ts";
import { operationRecord } from "./operation-read.ts";
import { StoredDocument } from "./record-schemas.ts";
import { advanceOperation, terminalReceipt } from "./operations.ts";
import { makeNativeJournal } from "./native-journal.ts";
import { retainNativeUncertainty } from "./native-complete.ts";
import { creationEvidence, finishCreation } from "./create-proof.ts";
import { nativeTypes } from "./target.ts";
import { officeFailure } from "./failure.ts";

export type CreationSeed =
  | { readonly kind: "data"; readonly input: CreateUnitFromDataInput }
  | { readonly kind: "snapshot"; readonly native: ISnapshotWithBlocks }
  | { readonly kind: "branch" };
export const commitCreation = Effect.fn("Office.commitCreation")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  original: OperationRecord,
  seed: CreationSeed | null,
  phase: "final-commit" | "recovery-dispatch",
) {
  if (original.intent.kind !== "create" && original.intent.kind !== "create-draft")
    return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  if (terminalReceipt(original.receipt.phase)) return original.receipt;
  const evidence = yield* creationEvidence(deps, original);
  if (!evidence.known) return yield* retainNativeUncertainty(deps, original);
  const target = yield* operationTarget(deps, original);
  // Historical confirmation needs no current-generation/native-content acquisition.
  const expectedHead = evidence.writes[0]?.baseRevision ?? null;
  return yield* deps.authority
    .serial(
      target,
      {
        operationId: original.receipt.operationId,
        expectedHead,
        reviewFingerprint: null,
        purpose: evidence.complete ? "proof" : "native",
      },
      (permit) =>
        Effect.scoped(
          Effect.gen(function* () {
            const current = yield* operationRecord(
              deps,
              original.owner,
              original.receipt.operationId,
            );
            if (current === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
            if (terminalReceipt(current.receipt.phase)) return current.receipt;
            const actual = yield* creationEvidence(deps, current);
            if (!actual.known) return yield* retainNativeUncertainty(deps, current);
            if (actual.complete) {
              yield* verifyOperation(deps, current, target, "recovery-observe");
              return yield* finishCreation(deps, current, permit, actual.acceptedRevision);
            }
            if (evidence.complete) return yield* retainNativeUncertainty(deps, current);
            // The only partial continuation is an unattempted new Unit after proven empty Worktree creation.
            const partial = actual.writes.length > 0;
            if (
              partial &&
              !(
                current.intent.kind === "create" &&
                current.intent.input.destination === "new-draft" &&
                actual.writes.length === 1 &&
                actual.writes[0]?.receiptKey.kind === "create-worktree"
              )
            )
              return yield* retainNativeUncertainty(deps, current);
            if (seed === null || current.policyVersion !== deps.policy.version)
              return yield* Effect.fail(
                officeFailure("EXECUTOR_UNCONFIGURED", current.receipt.operationId),
              );
            yield* verifyOperation(deps, current, target, phase);
            if (
              ["submission-unknown", "publishing", "needs-attention"].includes(
                current.receipt.phase,
              )
            )
              return yield* retainNativeUncertainty(deps, current);
            const admitted =
              current.receipt.phase === "admitted" || current.receipt.phase === "dispatching"
                ? current
                : yield* advanceOperation(deps, current, "admitted");
            const document = yield* decodeWire(StoredDocument)(
              yield* deps.metadata.document(current.owner, current.documentId),
            ).pipe(Effect.mapError(() => officeFailure("CONTENT_REQUIRED")));
            if (document.unitId !== current.unitId)
              return yield* Effect.fail(officeFailure("FORBIDDEN"));
            const journal = yield* makeNativeJournal(
              deps,
              admitted,
              permit,
              nativeTypes[document.document.kind],
              phase,
            );
            yield* runtime.invoke(
              { kind: "write", permit },
              current.worktreeId,
              target.scope.kind === "main" ? "main" : "lifecycle",
              journal,
              async (services) => {
                const context = { userID: current.owner.ownerId };
                if (target.scope.kind === "main") {
                  if (seed.kind === "branch") throw officeFailure("INVALID_INPUT");
                  const result =
                    seed.kind === "data"
                      ? await services.core.createUnitFromData(seed.input, context)
                      : await services.core.createUnitFromSnapshot(seed.native, context);
                  if (result.unitID !== current.unitId) throw officeFailure("CONTENT_REQUIRED");
                  return;
                }
                const worktreeID = current.worktreeId;
                if (worktreeID === null) throw officeFailure("CONTENT_REQUIRED");
                if (!partial)
                  await services.drafts.createWorktree(
                    { worktreeID, ...(seed.kind === "branch" ? { units: [current.unitId] } : {}) },
                    context,
                  );
                if (seed.kind === "data")
                  await services.drafts.createUnitFromData({ ...seed.input, worktreeID }, context);
                else if (seed.kind === "snapshot")
                  await services.drafts.createUnitFromSnapshot(
                    { ...seed.native, worktreeID },
                    context,
                  );
              },
            );
            const finished = yield* operationRecord(
              deps,
              original.owner,
              original.receipt.operationId,
            );
            if (finished === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
            const proof = yield* creationEvidence(deps, finished);
            if (!proof.known || !proof.complete)
              return yield* retainNativeUncertainty(deps, finished);
            return yield* finishCreation(deps, finished, permit, proof.acceptedRevision);
          }),
        ),
    )
    .pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const current = yield* operationRecord(
            deps,
            original.owner,
            original.receipt.operationId,
          );
          if (current === null) return yield* Effect.fail(error);
          if (terminalReceipt(current.receipt.phase)) return current.receipt;
          const proof = yield* creationEvidence(deps, current);
          if (proof.writes.length > 0) return yield* retainNativeUncertainty(deps, current);
          return yield* Effect.fail(error);
        }),
      ),
    );
});
