import { Effect } from "effect";
import type { OfficeDependencies, OperationRecord } from "../ports/index.ts";
import { nativeWrites, retainNativeUncertainty } from "./native-complete.ts";
import { observeNativeWrite } from "./write-observation.ts";
import { advanceOperation } from "./operations.ts";
import { operationRecord } from "./operation-read.ts";
import { officeFailure } from "./failure.ts";

/** Repair only already-accepted execution metadata. No SDK submit, source evaluation or native write acquisition. */
export const observeExecution = Effect.fn("Office.observeExecution")(function* (
  deps: OfficeDependencies,
  original: OperationRecord,
) {
  if (
    (original.intent.kind !== "execute" && original.intent.kind !== "import-into") ||
    original.worktreeId === null
  )
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", original.receipt.operationId));
  if (original.receipt.phase === "confirmed") return original.receipt;
  const input = original.intent.input;
  const originalTarget = {
    owner: original.owner,
    documentId: original.documentId,
    unitId: original.unitId,
    scope: {
      kind: "draft" as const,
      draftId: input.target.draftId,
      generation: input.target.generation,
    },
  };
  const writes = yield* nativeWrites(deps, original);
  if (writes.length === 0) return original.receipt;
  const [write] = writes;
  if (
    writes.length !== 1 ||
    write === undefined ||
    write.kind !== "changeset" ||
    write.receiptKey.kind !== "draft-change"
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", input.operationId));
  const observation = yield* observeNativeWrite(deps, original, originalTarget, write);
  if (observation.state !== "confirmed") return original.receipt;
  const acceptedRevision = write.receiptKey.revision;
  return yield* deps.authority
    .serial(
      originalTarget,
      {
        operationId: input.operationId,
        expectedHead: write.baseRevision,
        reviewFingerprint: null,
        purpose: "proof",
      },
      (permit) =>
        Effect.gen(function* () {
          const proven = yield* observeNativeWrite(deps, original, originalTarget, write);
          if (proven.state !== "confirmed")
            return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", input.operationId));
          yield* deps.metadata.confirmWrite(permit, write.id, acceptedRevision);
          const current = yield* operationRecord(deps, original.owner, input.operationId);
          if (current === null)
            return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", input.operationId));
          if (current.receipt.phase === "confirmed") return current.receipt;
          const complete = yield* advanceOperation(
            deps,
            current,
            "confirmed",
            {},
            { acceptedRevision, error: null },
          );
          return complete.receipt;
        }),
    )
    .pipe(
      Effect.catch(() =>
        Effect.gen(function* () {
          const current = yield* operationRecord(deps, original.owner, input.operationId);
          if (current === null)
            return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", input.operationId));
          if (current.receipt.phase === "confirmed") return current.receipt;
          return yield* retainNativeUncertainty(deps, current);
        }),
      ),
    );
});
