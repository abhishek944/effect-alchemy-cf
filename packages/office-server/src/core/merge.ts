import { Clock, Effect } from "effect";
import { Merge, decodeWire } from "@starter/office-contract";
import type {
  Actor,
  HumanActor,
  OfficeDependencies,
  OfficeService,
  OperationRecord,
  NativeTarget,
  RecoveryActor,
} from "../ports/index.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";
import { operationCaller, operationTarget } from "./operation-caller.ts";
import { operationRecord, requireExistingIntent } from "./operation-read.ts";
import { authorize, verifyOperation } from "./claims.ts";
import { initialOperation } from "./operation-create.ts";
import { assertReviewCurrent } from "./review-state.ts";
import { readReviewBundle } from "./review-bundle.ts";
import { nativeWrites } from "./native-complete.ts";
import { terminalReceipt } from "./operations.ts";
import { submitMerge } from "./merge-submit.ts";
import { observeMerge } from "./merge-observe.ts";
import { mergeAttention } from "./merge-finish.ts";
import { officeFailure } from "./failure.ts";

export const progressMerge = Effect.fn("Office.progressMerge")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  actor: Actor,
  input: Merge,
  dispatch: boolean,
) {
  if (actor.capability === "draft-task") return yield* Effect.fail(officeFailure("FORBIDDEN"));
  const context = yield* operationCaller(deps, actor, input.operationId, { kind: "merge", input });
  if (context.record !== null && terminalReceipt(context.record.receipt.phase))
    return context.record.receipt;
  const approval = yield* deps.metadata.approval(actor.owner, input.approvalOperationId);
  if (approval === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
  const review = yield* deps.metadata.review(actor.owner, approval.reviewId);
  if (review === null || review.fingerprint !== approval.fingerprint || review.removed)
    return yield* Effect.fail(officeFailure("STALE_REVIEW"));
  let target: NativeTarget;
  if (context.record !== null) target = yield* operationTarget(deps, context.record);
  else {
    const bundle = yield* readReviewBundle(deps, review);
    target = {
      owner: review.owner,
      documentId: review.documentId,
      unitId: review.unitId,
      scope: { kind: "draft", draftId: bundle.capture.draftId, generation: review.generation },
    };
  }
  if (
    target.documentId !== review.documentId ||
    target.unitId !== review.unitId ||
    target.scope.kind !== "draft" ||
    target.scope.generation !== review.generation
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", input.operationId));
  const observing =
    !dispatch ||
    (context.record !== null &&
      (context.record.receipt.phase !== "admitted" ||
        context.record.merge !== null ||
        context.record.artifacts.proposal !== null ||
        (yield* nativeWrites(deps, context.record)).length > 0));
  const previousBarrier = yield* deps.metadata.publicationBarrier(review.owner, review.documentId);
  if (context.record === null) {
    if (!dispatch || actor.capability !== "human" || context.claims?.capability !== "human")
      return yield* Effect.fail(officeFailure("FORBIDDEN"));
    if (
      previousBarrier !== null ||
      approval.consumedBy !== null ||
      approval.expiresAt <= (yield* Clock.currentTimeMillis) ||
      approval.humanPrincipalId !== context.claims.principalId ||
      approval.sessionEpoch !== context.claims.sessionEpoch
    )
      return yield* Effect.fail(officeFailure("STALE_REVIEW"));
    const approved = yield* operationRecord(deps, review.owner, approval.operationId);
    if (
      approved?.receipt.phase !== "confirmed" ||
      approved.intent.kind !== "approve" ||
      approved.intent.input.reviewId !== review.id
    )
      return yield* Effect.fail(officeFailure("STALE_REVIEW"));
    yield* authorize(deps, actor, "merge", target, input.operationId);
    yield* assertReviewCurrent(deps, review);
  }
  return yield* deps.authority.serial(
    target,
    {
      operationId: input.operationId,
      expectedHead: review.draftRevision,
      reviewFingerprint: review.fingerprint,
      purpose: observing ? "proof" : "native",
    },
    (permit) =>
      Effect.scoped(
        Effect.gen(function* () {
          let record: OperationRecord | null = yield* operationRecord(
            deps,
            review.owner,
            input.operationId,
          );
          if (record !== null && terminalReceipt(record.receipt.phase)) return record.receipt;
          const currentApproval = yield* deps.metadata.approval(
            review.owner,
            input.approvalOperationId,
          );
          if (
            currentApproval === null ||
            currentApproval.fingerprint !== review.fingerprint ||
            currentApproval.reviewId !== review.id
          )
            return yield* Effect.fail(officeFailure("STALE_REVIEW"));
          const barrier = yield* deps.metadata.publicationBarrier(review.owner, review.documentId);
          if (barrier !== null) {
            if (
              record === null ||
              barrier.operationId !== input.operationId ||
              barrier.approvalOperationId !== input.approvalOperationId ||
              barrier.reviewId !== review.id ||
              barrier.fingerprint !== review.fingerprint ||
              currentApproval.consumedBy !== input.operationId
            )
              return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", input.operationId));
          } else {
            if (
              actor.capability !== "human" ||
              context.claims?.capability !== "human" ||
              record !== null
            )
              return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", input.operationId));
            const current = yield* assertReviewCurrent(deps, review);
            const proposed = yield* initialOperation(
              deps,
              context.claims,
              { kind: "merge", input },
              current.document,
              current.draft,
            );
            const admitted: OperationRecord = {
              ...proposed,
              artifacts: { ...proposed.artifacts, source: review.preview },
              receipt: { ...proposed.receipt, phase: "admitted", version: 1, reviewId: review.id },
            };
            yield* verifyOperation(deps, admitted, target, "final-commit");
            yield* deps.metadata.admitPublication(
              permit,
              admitted,
              input.approvalOperationId,
              review.fingerprint,
            );
            record = yield* operationRecord(deps, review.owner, input.operationId);
            if (record === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
          }
          if (record === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
          if (context.claims !== null)
            yield* requireExistingIntent(deps, context.claims, record, { kind: "merge", input });
          if (
            observing ||
            record.receipt.phase !== "admitted" ||
            record.merge !== null ||
            record.artifacts.proposal !== null ||
            (yield* nativeWrites(deps, record)).length > 0
          )
            return yield* observeMerge(deps, runtime, actor, record, review, permit);
          if (approval.expiresAt <= (yield* Clock.currentTimeMillis))
            return yield* mergeAttention(deps, record, review, permit);
          return yield* submitMerge(
            deps,
            runtime,
            record,
            review,
            permit,
            context.record === null ? "final-commit" : "recovery-dispatch",
          );
        }),
      ),
  );
});
export function makeOfficeMerge(
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
): Pick<OfficeService, "merge"> {
  return {
    merge: (actor: HumanActor | RecoveryActor, value: Merge) =>
      decodeWire(Merge)(value).pipe(
        Effect.mapError(() => officeFailure("INVALID_INPUT")),
        Effect.flatMap((input) => progressMerge(deps, runtime, actor, input, true)),
      ),
  };
}
