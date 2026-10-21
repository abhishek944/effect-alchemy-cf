import { Effect } from "effect";
import { safeFailure, type Receipt } from "@starter/office-contract";
import type {
  NativeWriteRecord,
  OfficeDependencies,
  OperationRecord,
  Page,
  WritePermit,
} from "../ports/index.ts";
import { observeNativeWrite, originalWriteTarget } from "./write-observation.ts";
import { advanceOperation, terminalReceipt } from "./operations.ts";
import { operationRecord } from "./operation-read.ts";
import { officeFailure } from "./failure.ts";

export const nativeWrites = Effect.fn("Office.nativeWrites")(function* (
  deps: OfficeDependencies,
  operation: OperationRecord,
) {
  const writes: NativeWriteRecord[] = [];
  let cursor: string | null = null;
  for (let index = 0; index < 8; index++) {
    const page: Page<NativeWriteRecord> = yield* deps.metadata.writes(
      operation.owner,
      operation.receipt.operationId,
      cursor,
    );
    writes.push(...page.items);
    cursor = page.next;
    if (cursor === null) return writes;
  }
  return yield* Effect.fail(officeFailure("LIMIT_EXCEEDED", operation.receipt.operationId));
});
/** Exact accepted original scalar proof only; never materialize a native write or refresh its basis. */
export const proposedNativeRevision = Effect.fn("Office.proposedNativeRevision")(function* (
  deps: OfficeDependencies,
  operation: OperationRecord,
  write: NativeWriteRecord,
) {
  const observation = yield* observeNativeWrite(
    deps,
    operation,
    originalWriteTarget(operation, write),
    write,
  );
  if (observation.state !== "confirmed")
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", write.operationId));
  return observation.acceptedRevision;
});
export const confirmNativeWrites = Effect.fn("Office.confirmNativeWrites")(function* (
  deps: OfficeDependencies,
  operation: OperationRecord,
  permit: WritePermit,
) {
  const writes = yield* nativeWrites(deps, operation);
  if (writes.length === 0)
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", permit.operationId));
  for (const write of writes) {
    const revision = yield* proposedNativeRevision(deps, operation, write);
    yield* deps.metadata.confirmWrite(permit, write.id, revision);
  }
  return writes;
});
export const completeNativeOperation = Effect.fn("Office.completeNativeOperation")(function* (
  deps: OfficeDependencies,
  operation: OperationRecord,
  permit: WritePermit,
  acceptedRevision: number | null,
  update: Partial<Pick<Receipt, "artifact" | "reviewId">> = {},
) {
  yield* confirmNativeWrites(deps, operation, permit);
  const current = yield* operationRecord(deps, operation.owner, operation.receipt.operationId);
  if (current === null)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", permit.operationId));
  if (terminalReceipt(current.receipt.phase)) return current.receipt;
  const saved = yield* advanceOperation(
    deps,
    current,
    "confirmed",
    {},
    { ...update, acceptedRevision, error: null },
  );
  return saved.receipt;
});
export const retainNativeUncertainty = Effect.fn("Office.retainNativeUncertainty")(function* (
  deps: OfficeDependencies,
  operation: OperationRecord,
) {
  const current = yield* operationRecord(deps, operation.owner, operation.receipt.operationId);
  if (current === null)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", operation.receipt.operationId));
  if (terminalReceipt(current.receipt.phase)) return current.receipt;
  const writes = yield* nativeWrites(deps, current);
  const acceptedRevision =
    writes
      .filter((write) => write.phase === "confirmed" && write.kind === "changeset")
      .map((write) => write.acceptedRevision)
      .find((value) => value !== null) ?? current.receipt.acceptedRevision;
  const saved = yield* advanceOperation(
    deps,
    current,
    current.receipt.phase === "admitted"
      ? "publishing"
      : current.receipt.phase === "publishing" ||
          current.receipt.phase === "needs-attention" ||
          current.intent.kind === "merge"
        ? "needs-attention"
        : "submission-unknown",
    {},
    {
      acceptedRevision,
      error: safeFailure("OUTCOME_UNKNOWN", current.receipt.operationId),
    },
  );
  return saved.receipt;
});
