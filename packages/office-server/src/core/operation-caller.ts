import { Clock, Effect } from "effect";
import { decodeWire } from "@starter/office-contract";
import { OwnerClaims } from "../ports/index.ts";
import type {
  Actor,
  NativeTarget,
  OfficeDependencies,
  OperationIntent,
  OperationRecord,
} from "../ports/index.ts";
import { authorize, sameOwner, verifyOperation } from "./claims.ts";
import { StoredView } from "./record-schemas.ts";
import { operationRecord, requireExistingIntent, requireIntent } from "./operation-read.ts";
import { nativeWrites } from "./native-complete.ts";
import { officeFailure } from "./failure.ts";

/** Reconstruct original control scope, never refresh a stored task into a newer generation. */
export const operationTarget = Effect.fn("Office.operationTarget")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
) {
  const base = { owner: record.owner, documentId: record.documentId, unitId: record.unitId };
  const intent = record.intent;
  if (intent.kind === "execute" || intent.kind === "import-into")
    return {
      ...base,
      scope: {
        kind: "draft" as const,
        draftId: intent.input.target.draftId,
        generation: intent.input.target.generation,
      },
    };
  if (intent.kind === "ready" || intent.kind === "reopen" || intent.kind === "discard")
    return {
      ...base,
      scope: {
        kind: "draft" as const,
        draftId: intent.input.draftId,
        generation: intent.input.generation,
      },
    };
  if (record.receipt.draftId === null) return { ...base, scope: { kind: "main" as const } };
  let generation: number | null = null;
  if (intent.kind === "approve" || intent.kind === "merge") {
    const approval =
      intent.kind === "merge"
        ? yield* deps.metadata.approval(record.owner, intent.input.approvalOperationId)
        : null;
    const id = intent.kind === "approve" ? intent.input.reviewId : approval?.reviewId;
    const review = id === undefined ? null : yield* deps.metadata.review(record.owner, id);
    if (
      review === null ||
      review.documentId !== record.documentId ||
      review.worktreeId !== record.worktreeId
    )
      return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", record.receipt.operationId));
    generation = review.generation;
  } else if (intent.kind === "render" || intent.kind === "export") {
    const job = record.jobId === null ? null : yield* deps.metadata.job(record.owner, record.jobId);
    generation = job?.job.binding.generation ?? null;
    if (generation === null) {
      const historical = yield* deps.metadata.historicalViewTarget(
        record.owner,
        intent.input.viewId,
      );
      if (historical === null)
        return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", record.receipt.operationId));
      const target = yield* decodeWire(StoredView.fields.target)(historical).pipe(
        Effect.mapError(() => officeFailure("CONTENT_REQUIRED", record.receipt.operationId)),
      );
      if (
        !sameOwner(target.owner, record.owner) ||
        target.documentId !== record.documentId ||
        target.unitId !== record.unitId ||
        target.scope.kind !== "draft" ||
        target.scope.draftId !== record.receipt.draftId
      )
        return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", record.receipt.operationId));
      return target;
    }
  } else {
    const writes = yield* nativeWrites(deps, record);
    generation = writes.find((value) => value.generation !== null)?.generation ?? null;
    if (generation === null && writes.length === 0) {
      const draft = yield* deps.metadata.draft(record.owner, record.receipt.draftId);
      // Before any native attempt, creation cannot have changed this reserved branch's generation.
      if (draft?.documentId === record.documentId && draft.worktreeId === record.worktreeId)
        generation = draft.generation;
    }
  }
  if (generation === null)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED", record.receipt.operationId));
  const target: NativeTarget = {
    ...base,
    scope: { kind: "draft", draftId: record.receipt.draftId, generation },
  };
  return target;
});
export const operationCaller = Effect.fn("Office.operationCaller")(function* (
  deps: OfficeDependencies,
  actor: Actor,
  operationId: string,
  intent: OperationIntent | null,
) {
  const owner = yield* decodeWire(OwnerClaims)(actor.owner).pipe(
    Effect.mapError(() => officeFailure("FORBIDDEN")),
  );
  const claims =
    actor.capability === "recovery"
      ? null
      : yield* authorize(deps, actor, "discover", null, operationId);
  const record = yield* operationRecord(deps, owner, operationId);
  if (actor.capability === "recovery") {
    const now = yield* Clock.currentTimeMillis;
    if (
      record === null ||
      actor.operationId !== operationId ||
      actor.documentId !== record.documentId ||
      actor.expiresAt <= now
    )
      return yield* Effect.fail(officeFailure("FORBIDDEN", operationId));
    if (intent !== null) yield* requireIntent(deps, record, intent);
    yield* verifyOperation(deps, record, yield* operationTarget(deps, record), "recovery-observe");
  } else if (record !== null && claims !== null) {
    yield* requireExistingIntent(deps, claims, record, intent ?? record.intent);
    yield* verifyOperation(deps, record, yield* operationTarget(deps, record), "recovery-observe");
  }
  return { claims, record };
});
