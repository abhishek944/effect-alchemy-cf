import { Effect } from "effect";
import { decodeWire } from "@starter/office-contract";
import type {
  ActorClaims,
  DocumentRecord,
  DraftRecord,
  OfficeDependencies,
  OperationIntent,
} from "../ports/index.ts";
import { Intent } from "./record-schemas.ts";
import { actorIdentity, boundedMetadataDigest, intentIdentity } from "./control-identity.ts";
import { operationTuple } from "../storage-remote/operation-identity.ts";
import { officeFailure } from "./failure.ts";

export type PreparedOperation = {
  readonly intent: typeof Intent.Type;
  readonly lineageDigest: string;
  readonly intentDigest: string;
};

/**
 * One owner for intent validation, the draft-task capability restriction and the persisted
 * identity digests. Reserve comparison and initial record construction must share one result.
 */
export const prepareOperation = Effect.fn("Office.prepareOperation")(function* (
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
  const limit = deps.policy.limits.metadataBytes;
  const lineageDigest = yield* boundedMetadataDigest(actorIdentity(actor), limit);
  const intentDigest = yield* boundedMetadataDigest(
    operationTuple(
      intentIdentity(intent),
      document.document.id,
      document.unitId,
      draft?.worktreeId ?? null,
      deps.policy.version,
    ),
    limit,
  );
  return { intent, lineageDigest, intentDigest } satisfies PreparedOperation;
});
