import { Effect } from "effect";
import { safeFailure } from "@starter/office-contract";
import type { IsolatedJob, JobState, OfficeDependencies, OperationRecord } from "../ports/index.ts";
import { advanceOperation, terminalReceipt } from "./operations.ts";
import { operationRecord } from "./operation-read.ts";
import { officeFailure } from "./failure.ts";
import { verifyOperation } from "./claims.ts";
import { operationTarget } from "./operation-caller.ts";

/** Reflect an actual claimed job. Never promise dispatch for unclaimed queued version zero. */
export const storeJobState = Effect.fn("Office.storeJobState")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
  job: IsolatedJob,
  state: JobState,
) {
  if (state.jobId !== job.binding.jobId)
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  let current = yield* operationRecord(deps, record.owner, record.receipt.operationId);
  if (
    current === null ||
    current.intentDigest !== record.intentDigest ||
    current.lineageDigest !== record.lineageDigest
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  yield* verifyOperation(deps, current, yield* operationTarget(deps, current), "recovery-observe");
  if (
    terminalReceipt(current.receipt.phase) ||
    !["reserved", "input-pinned", "queued", "running"].includes(current.receipt.phase)
  )
    return current;
  if (state.state === "queued") {
    const error = safeFailure("BUSY", record.receipt.operationId);
    if (current.receipt.error?.code === error.code) return current;
    return yield* advanceOperation(deps, current, current.receipt.phase, {}, { error });
  }
  if (state.state === "failed")
    return yield* advanceOperation(
      deps,
      current,
      "failed-before-submit",
      {},
      {
        error: safeFailure(state.error.code, record.receipt.operationId),
      },
    );
  // The concrete operation state machine has queued -> running, even when submit already finished.
  // This transition occurs only AFTER actual running/succeeded/unknown claim acknowledgement.
  if (current.receipt.phase === "input-pinned")
    current = yield* advanceOperation(deps, current, "queued");
  if (current.receipt.phase === "queued")
    current = yield* advanceOperation(deps, current, "running", {}, { error: null });
  if (current.receipt.phase !== "running")
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", record.receipt.operationId));
  if (state.state === "execution-unknown")
    return yield* advanceOperation(
      deps,
      current,
      "execution-unknown",
      {},
      {
        error: safeFailure("OUTCOME_UNKNOWN", record.receipt.operationId),
      },
    );
  return current;
});
