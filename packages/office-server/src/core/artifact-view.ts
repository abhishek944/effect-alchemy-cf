import { randomUUID } from "node:crypto";
import { Clock, Effect } from "effect";
import { View, decodeWire, type Kind, type OfficeError } from "@starter/office-contract";
import type { ISnapshotWithBlocks } from "@univerjs-pro/collaboration-service";
import type {
  NativeTarget,
  OfficeDependencies,
  OperationRecord,
  WritePermit,
  ViewRecord,
} from "../ports/index.ts";
import { SnapshotWithBlocksSchema } from "../jobs/snapshot-schema.ts";
import { prepareSdkSnapshot } from "../storage-remote/producer.ts";
import { sameOwner, verifyOperation } from "./claims.ts";
import { officeFailure } from "./failure.ts";
import { nativeTypes } from "./target.ts";
import { stageNativeArtifact } from "./bytes.ts";
import { StoredView } from "./record-schemas.ts";

/** Private active Ready producer: persist one immutable role through the existing View boundary. */
export const stageReadyRoleView = Effect.fn("Office.stageReadyRoleView")(function* (
  deps: OfficeDependencies,
  original: OperationRecord,
  permit: WritePermit,
  target: NativeTarget,
  kind: Kind,
  input: ISnapshotWithBlocks,
  phase: "final-commit" | "recovery-dispatch",
): Effect.fn.Return<ViewRecord, OfficeError> {
  yield* verifyOperation(deps, original, permit.target, phase);
  if (
    original.intent.kind !== "ready" ||
    permit.operationId !== original.receipt.operationId ||
    permit.documentId !== original.documentId ||
    !sameOwner(permit.owner, original.owner) ||
    !sameOwner(target.owner, original.owner) ||
    target.documentId !== original.documentId ||
    target.unitId !== original.unitId ||
    (target.scope.kind === "draft" &&
      (target.scope.draftId !== original.intent.input.draftId ||
        target.scope.generation !== original.intent.input.generation))
  )
    return yield* Effect.fail(officeFailure("FORBIDDEN", original.receipt.operationId));
  const native = yield* decodeWire(SnapshotWithBlocksSchema)(input).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED", permit.operationId)),
  );
  yield* Effect.try({
    try: () =>
      prepareSdkSnapshot(
        native.snapshot,
        native.sheetBlocks,
        { unitID: original.unitId, type: nativeTypes[kind], revision: native.snapshot.rev },
        deps.policy.limits.nativeBytes,
      ),
    catch: () => officeFailure("CONTENT_REQUIRED", permit.operationId),
  });
  const now = yield* Clock.currentTimeMillis;
  if (original.actor.expiresAt <= now)
    return yield* Effect.fail(officeFailure("UNAUTHENTICATED", permit.operationId));
  const artifact = yield* stageNativeArtifact(
    deps,
    original.owner,
    "native-preview",
    "merge-artifact",
    native,
  );
  const id = randomUUID();
  const view = yield* decodeWire(View)({
    id,
    documentId: original.documentId,
    kind,
    revision: native.snapshot.rev,
    nativeTarget: { kind: "pinned-snapshot", unitId: original.unitId },
    mode: "read-only",
    protocolPrefix: `/api/office/views/${id}/protocol`,
    expiresAt: Math.min(original.actor.expiresAt, now + 300_000),
  }).pipe(Effect.mapError(() => officeFailure("CONTENT_REQUIRED", permit.operationId)));
  const candidate = yield* decodeWire(StoredView)({
    owner: original.owner,
    view,
    target,
    authorityEpoch: permit.authorityEpoch,
    serviceEpoch: permit.serviceEpoch,
    source: { kind: "artifact", artifact },
  }).pipe(Effect.mapError(() => officeFailure("CONTENT_REQUIRED", permit.operationId)));
  yield* verifyOperation(deps, original, permit.target, phase);
  const stored = yield* deps.metadata.putView(candidate);
  const normalized = yield* decodeWire(StoredView)(stored).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED", permit.operationId)),
  );
  if (JSON.stringify(normalized) !== JSON.stringify(candidate))
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", permit.operationId));
  return normalized;
});
