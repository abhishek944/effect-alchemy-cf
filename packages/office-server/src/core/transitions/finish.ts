import { Effect } from "effect";
import type { OfficeDependencies, OperationRecord, WritePermit } from "../../ports/index.ts";
import { verifyOperation } from "../claims.ts";
import { confirmNativeWrites } from "../native-complete.ts";
import { operationRecord } from "../operation-read.ts";
import { advanceOperation, terminalReceipt } from "../operations.ts";
import { officeFailure } from "../failure.ts";
import { transitionBasis, transitionEvidence } from "./basis.ts";

export const finishTransition = Effect.fn("Office.transitions.finish")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
  permit: WritePermit,
) {
  const basis = yield* transitionBasis(deps, record);
  yield* verifyOperation(deps, record, basis.target, "recovery-observe");
  const evidence = yield* transitionEvidence(deps, record, basis);
  if (evidence === null || !evidence.confirmed)
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", record.receipt.operationId));
  // Recheck the actual prepared slot even when the journal already says confirmed.
  yield* confirmNativeWrites(deps, record, permit);
  if (basis.kind === "reopen" && basis.draft.generation === basis.generation) {
    const advanced = yield* deps.metadata.advanceGeneration(
      permit,
      basis.draft.id,
      basis.generation,
    );
    if (
      advanced.id !== basis.draft.id ||
      advanced.documentId !== record.documentId ||
      advanced.worktreeId !== basis.worktreeId ||
      advanced.generation !== basis.generation + 1
    )
      return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  }
  // Later metadata generations are historical success, never renewed task/content authority.
  const current = yield* operationRecord(deps, record.owner, record.receipt.operationId);
  if (current === null)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", record.receipt.operationId));
  if (terminalReceipt(current.receipt.phase)) return current.receipt;
  return (yield* advanceOperation(
    deps,
    current,
    "confirmed",
    {},
    { acceptedRevision: null, error: null },
  )).receipt;
});
