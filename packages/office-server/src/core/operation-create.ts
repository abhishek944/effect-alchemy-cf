import { Clock, Effect } from "effect";
import { Receipt, decodeWire } from "@starter/office-contract";
import type {
  ActorClaims,
  DocumentRecord,
  DraftRecord,
  OfficeDependencies,
  OperationIntent,
  OperationRecord,
} from "../ports/index.ts";
import { StoredOperation } from "./record-schemas.ts";
import { boundedMetadataDigest } from "./control-identity.ts";
import { officeFailure } from "./failure.ts";
import { prepareOperation, type PreparedOperation } from "./operation-prepare.ts";

/** Requested record from an already prepared identity; no duplicated intent/digest work. */
export const createOperationRecord = Effect.fn("Office.createOperationRecord")(function* (
  deps: OfficeDependencies,
  actor: ActorClaims,
  prepared: PreparedOperation,
  document: DocumentRecord,
  draft: DraftRecord | null,
) {
  const now = yield* Clock.currentTimeMillis;
  const { intent, intentDigest, lineageDigest } = prepared;
  const receipt = yield* decodeWire(Receipt)({
    operationId: intent.input.operationId,
    kind: intent.kind,
    phase: "reserved",
    version: 0,
    documentId: document.document.id,
    draftId: draft?.id ?? null,
    reviewId: null,
    artifact: null,
    acceptedRevision: null,
    retryAfterMs: null,
    error: null,
  }).pipe(Effect.mapError(() => officeFailure("INVALID_INPUT")));
  const record: OperationRecord = {
    owner: actor.owner,
    actor,
    documentId: document.document.id,
    unitId: document.unitId,
    worktreeId: draft?.worktreeId ?? null,
    intent,
    intentDigest,
    lineageDigest,
    receipt,
    artifacts: { source: null, input: null, code: null, proposal: null },
    merge: null,
    jobId: null,
    policyVersion: deps.policy.version,
    createdAt: now,
    updatedAt: now,
  };
  const normalized = yield* decodeWire(StoredOperation)(record).pipe(
    Effect.mapError(() => officeFailure("INVALID_INPUT")),
  );
  yield* boundedMetadataDigest(normalized, deps.policy.limits.metadataBytes);
  return normalized;
});

/** Construction only: merge uses this inside atomic approval consumption/barrier reservation, not a prior insert. */
export const initialOperation = Effect.fn("Office.initialOperation")(function* (
  deps: OfficeDependencies,
  actor: ActorClaims,
  value: OperationIntent,
  document: DocumentRecord,
  draft: DraftRecord | null,
) {
  const prepared = yield* prepareOperation(deps, actor, value, document, draft);
  return yield* createOperationRecord(deps, actor, prepared, document, draft);
});
