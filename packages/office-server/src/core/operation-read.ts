import { Effect } from "effect";
import { decodeWire } from "@highchat/office-contract";
import type {
  ActorClaims,
  OfficeDependencies,
  OperationIntent,
  OperationRecord,
  OwnerScope,
} from "../ports/index.ts";
import { Intent, StoredOperation } from "./record-schemas.ts";
import { metadataDigestEffect } from "./operations.ts";
import { sameOwner } from "./claims.ts";
import { officeFailure } from "./failure.ts";
import { acceptedInputIdentity, intentIdentity } from "./control-identity.ts";

export const operationRecord = Effect.fn("Office.operationRecord")(function* (
  deps: OfficeDependencies,
  owner: OwnerScope,
  operationId: string,
) {
  const raw = yield* deps.metadata.operation(owner, operationId);
  if (raw === null) return null;
  const record = yield* decodeWire(StoredOperation)(raw).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED", operationId)),
  );
  if (!sameOwner(record.owner, owner) || record.receipt.operationId !== operationId)
    return yield* Effect.fail(officeFailure("FORBIDDEN", operationId));
  return record;
});
export const requireIntent = Effect.fn("Office.requireIntent")(function* (
  record: OperationRecord,
  value: OperationIntent,
) {
  const intent = yield* decodeWire(Intent)(value).pipe(
    Effect.mapError(() => officeFailure("INVALID_INPUT")),
  );
  const expected = yield* metadataDigestEffect(intentIdentity(record.intent));
  const actual = yield* metadataDigestEffect(intentIdentity(intent));
  if (actual !== expected)
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  return undefined;
});
/** Receipt correlation only AFTER genuine request authorization; never mutation identity. */
export const requireReceiptInput = Effect.fn("Office.requireReceiptInput")(function* (
  claims: ActorClaims,
  record: OperationRecord,
) {
  if (!sameOwner(claims.owner, record.owner) || !sameOwner(record.actor.owner, record.owner))
    return yield* Effect.fail(officeFailure("FORBIDDEN", record.receipt.operationId));
  if (claims.capability === "draft-task") {
    const previous = record.actor;
    if (
      previous.capability !== "draft-task" ||
      previous.principalId !== claims.principalId ||
      previous.sessionEpoch !== claims.sessionEpoch ||
      previous.acceptedInput.requestId !== claims.acceptedInput.requestId ||
      previous.acceptedInput.submissionId !== claims.acceptedInput.submissionId ||
      previous.acceptedInput.conversationId !== claims.acceptedInput.conversationId ||
      previous.acceptedInput.digest !== claims.acceptedInput.digest
    )
      return yield* Effect.fail(officeFailure("FORBIDDEN", record.receipt.operationId));
  }
  return undefined;
});
export const requireExistingIntent = Effect.fn("Office.requireExistingIntent")(function* (
  claims: ActorClaims,
  record: OperationRecord,
  value: OperationIntent,
) {
  yield* requireIntent(record, value);
  if (!sameOwner(claims.owner, record.owner)) return yield* Effect.fail(officeFailure("FORBIDDEN"));
  if (claims.capability === "draft-task") {
    if (record.actor.capability !== "draft-task")
      return yield* Effect.fail(officeFailure("FORBIDDEN"));
    const before = yield* metadataDigestEffect(acceptedInputIdentity(record.actor.acceptedInput));
    const after = yield* metadataDigestEffect(acceptedInputIdentity(claims.acceptedInput));
    if (before !== after || claims.principalId !== record.actor.principalId)
      return yield* Effect.fail(officeFailure("FORBIDDEN", record.receipt.operationId));
  }
  return undefined;
});
