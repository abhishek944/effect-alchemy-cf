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
import { Intent, StoredOperation } from "./record-schemas.ts";
import { actorIdentity, intentIdentity } from "./control-identity.ts";
import { boundedMetadataDigest } from "./control-identity.ts";
import { officeFailure } from "./failure.ts";

/** Construction only: merge uses this inside atomic approval consumption/barrier reservation, not a prior insert. */
export const initialOperation = Effect.fn("Office.initialOperation")(function* (
  deps: OfficeDependencies,
  actor: ActorClaims,
  value: OperationIntent,
  document: DocumentRecord,
  draft: DraftRecord | null,
) {
  const intent = yield* decodeWire(Intent)(value).pipe(
    Effect.mapError(() => officeFailure("INVALID_INPUT")),
  );
  if (
    actor.capability === "draft-task" &&
    (intent.kind === "approve" ||
      intent.kind === "merge" ||
      (intent.kind === "create" && intent.input.destination !== "new-draft"))
  )
    return yield* Effect.fail(officeFailure("FORBIDDEN", intent.input.operationId));
  const now = yield* Clock.currentTimeMillis;
  const lineageDigest = yield* boundedMetadataDigest(
    actorIdentity(actor),
    deps.policy.limits.metadataBytes,
  );
  const intentDigest = yield* boundedMetadataDigest(
    [
      "office-operation",
      1,
      intentIdentity(intent),
      document.document.id,
      document.unitId,
      draft?.worktreeId ?? null,
      deps.policy.version,
    ],
    deps.policy.limits.metadataBytes,
  );
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
