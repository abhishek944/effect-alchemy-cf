import { Effect } from "effect";
import { Id, decodeWire } from "@starter/office-contract";
import type { Actor, OfficeDependencies, OfficeService, OperationRecord } from "../ports/index.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";
import { operationCaller, operationTarget } from "./operation-caller.ts";
import { operationRecord, requireExistingIntent } from "./operation-read.ts";
import { advanceOperation, terminalReceipt } from "./operations.ts";
import { nativeWrites } from "./native-complete.ts";
import { progressExecution } from "./execute.ts";
import { progressImportInto } from "./import-into.ts";
import { progressCreation } from "./create.ts";
import { progressReady } from "./ready.ts";
import { progressMerge } from "./merge.ts";
import { observeReadOutput } from "./read-jobs/observe.ts";
import { verifyOperation } from "./claims.ts";
import { officeFailure } from "./failure.ts";
import { progressTransition } from "./transitions/progress.ts";

const observeApproval = Effect.fn("Office.observeApproval")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
) {
  if (record.intent.kind !== "approve" || record.actor.capability !== "human")
    return record.receipt;
  const approval = yield* deps.metadata.approval(record.owner, record.receipt.operationId);
  if (approval === null) return record.receipt;
  if (
    approval.reviewId !== record.intent.input.reviewId ||
    approval.humanPrincipalId !== record.actor.principalId ||
    approval.sessionEpoch !== record.actor.sessionEpoch
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT"));
  yield* verifyOperation(deps, record, yield* operationTarget(deps, record), "recovery-observe");
  const current = yield* operationRecord(deps, record.owner, record.receipt.operationId);
  if (current === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  if (terminalReceipt(current.receipt.phase)) return current.receipt;
  return (yield* advanceOperation(
    deps,
    current,
    "confirmed",
    {},
    { reviewId: approval.reviewId, acceptedRevision: null, error: null },
  )).receipt;
});
export function makeOfficeOperations(
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
): Pick<OfficeService, "receipt" | "cancel"> {
  const receipt = Effect.fn("Office.receipt")(function* (actor: Actor, value: string) {
    const id = yield* decodeWire(Id)(value).pipe(
      Effect.mapError(() => officeFailure("INVALID_INPUT")),
    );
    const context = yield* operationCaller(deps, actor, id, "receipt");
    const record = context.record;
    if (record === null) return yield* Effect.fail(officeFailure("NOT_FOUND", id));
    if (terminalReceipt(record.receipt.phase)) return record.receipt;
    switch (record.intent.kind) {
      case "execute":
        return yield* progressExecution(deps, runtime, record, false);
      case "import-into":
        return yield* progressImportInto(deps, runtime, record, false);
      case "create":
      case "create-draft":
        return yield* progressCreation(deps, runtime, record, false);
      case "ready":
        return yield* progressReady(deps, runtime, actor, record, false);
      case "render":
      case "export":
        return yield* observeReadOutput(deps, actor, record);
      case "approve":
        return yield* observeApproval(deps, record);
      case "merge":
        return actor.capability === "draft-task"
          ? record.receipt
          : yield* progressMerge(deps, runtime, actor, record.intent.input, false);
      case "reopen":
      case "discard": {
        // Never initiate an unattempted lifecycle transition from an observation request.
        if ((yield* nativeWrites(deps, record)).length === 0) return record.receipt;
        return yield* progressTransition(deps, runtime, record, "recovery-observe");
      }
    }
    return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  });
  return {
    receipt,
    cancel: Effect.fn("Office.cancel")(function* (actor: Actor, value: string) {
      const id = yield* decodeWire(Id)(value).pipe(
        Effect.mapError(() => officeFailure("INVALID_INPUT")),
      );
      const context = yield* operationCaller(deps, actor, id, null);
      let record = context.record;
      if (record === null) return yield* Effect.fail(officeFailure("NOT_FOUND", id));
      if (context.claims !== null)
        yield* requireExistingIntent(deps, context.claims, record, record.intent);
      if (terminalReceipt(record.receipt.phase)) return record.receipt;
      if (
        record.intent.kind === "approve" ||
        record.intent.kind === "merge" ||
        !["reserved", "input-pinned", "queued", "running", "proposal-staged"].includes(
          record.receipt.phase,
        ) ||
        (yield* nativeWrites(deps, record)).length > 0
      )
        return yield* Effect.fail(officeFailure("NOT_EDITABLE", id));
      // CAS blocks future native admission. This does not assert that isolated code never ran or roll back a write.
      record = yield* advanceOperation(deps, record, "cancelled-before-dispatch");
      if (record.jobId !== null) yield* deps.jobs.cancel(record.owner, record.jobId);
      return record.receipt;
    }),
  };
}
