import { Effect, Schema } from "effect";
import { Revision, decodeWire } from "@starter/office-contract";
import { NativeReceiptBinding, NativeReceiptKey } from "../ports/index.ts";
import type {
  NativeTarget,
  NativeWriteRecord,
  OfficeDependencies,
  OperationRecord,
  OwnerScope,
  Page,
} from "../ports/index.ts";
import { verifyOperation } from "./claims.ts";
import { officeFailure } from "./failure.ts";
import { StoredArtifact } from "./record-schemas.ts";

export const findNativeWrite = Effect.fn("Office.findNativeWrite")(function* (
  deps: OfficeDependencies,
  owner: OwnerScope,
  operationId: string,
  writeId: string,
) {
  let cursor: string | null = null;
  for (let index = 0; index < 8; index++) {
    const page: Page<NativeWriteRecord> = yield* deps.metadata.writes(owner, operationId, cursor);
    const found = page.items.find((item) => item.id === writeId);
    if (found) return found;
    cursor = page.next;
    if (cursor === null) return null;
  }
  return yield* Effect.fail(officeFailure("LIMIT_EXCEEDED", operationId));
});
export const observeNativeWrite = Effect.fn("Office.observeNativeWrite")(function* (
  deps: OfficeDependencies,
  operation: OperationRecord,
  target: NativeTarget,
  write: NativeWriteRecord,
) {
  yield* verifyOperation(deps, operation, target, "recovery-observe");
  if (
    write.operationId !== operation.receipt.operationId ||
    write.documentId !== operation.documentId ||
    write.unitId !== operation.unitId
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", operation.receipt.operationId));
  const receipt = yield* decodeWire(NativeReceiptKey)(write.receiptKey).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED", write.operationId)),
  );
  const payload = yield* decodeWire(StoredArtifact)(write.payload).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED", write.operationId)),
  );
  if (payload.kind !== "native-write")
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", write.operationId));
  if (write.preparedReceipt === null) return { state: "unknown" as const };
  const expected = yield* decodeWire(NativeReceiptBinding)(write.preparedReceipt).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED", write.operationId)),
  );
  const observed = yield* deps.observeNativeReceipt({
    target,
    operationId: write.operationId,
    stepId: write.stepId,
    writeId: write.id,
    payloadDigest: payload.digest,
    receipt,
    expected,
  });
  if (observed.state === "unknown") return { state: "unknown" as const };
  if (
    observed.fingerprint !== expected.fingerprint ||
    observed.authorityEpoch !== expected.authorityEpoch
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", write.operationId));
  const acceptedRevision = yield* decodeWire(Schema.NullOr(Revision))(
    observed.acceptedRevision,
  ).pipe(Effect.mapError(() => officeFailure("CONTENT_REQUIRED", write.operationId)));
  if (
    (write.kind === "lifecycle") !== (acceptedRevision === null) ||
    ((receipt.kind === "main-change" ||
      receipt.kind === "draft-change" ||
      receipt.kind === "snapshot") &&
      receipt.revision !== acceptedRevision)
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", write.operationId));
  return { state: "confirmed" as const, ...expected, acceptedRevision };
});
export function originalWriteTarget(
  operation: OperationRecord,
  write: NativeWriteRecord,
): NativeTarget {
  if (write.generation !== null && operation.receipt.draftId === null)
    throw officeFailure("CONTENT_REQUIRED", write.operationId);
  return {
    owner: operation.owner,
    documentId: operation.documentId,
    unitId: operation.unitId,
    scope:
      write.generation !== null && operation.receipt.draftId !== null
        ? { kind: "draft", draftId: operation.receipt.draftId, generation: write.generation }
        : { kind: "main" },
  };
}
