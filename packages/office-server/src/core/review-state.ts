import { Clock, Effect } from "effect";
import type { FrozenReview, OfficeDependencies } from "../ports/index.ts";
import { readReviewBundle } from "./review-bundle.ts";
import { nativeTypes } from "./target.ts";
import { nativeCall, officeFailure } from "./failure.ts";

/** Check the real frozen basis, not a proposed artifact header's possibly-future revision. */
export const assertReviewCurrent = Effect.fn("Office.assertReviewCurrent")(function* (
  deps: OfficeDependencies,
  review: FrozenReview,
) {
  const now = yield* Clock.currentTimeMillis;
  if (
    review.expiresAt <= now ||
    review.state !== "complete" ||
    review.policyVersion !== deps.policy.version ||
    review.sdkVersion !== deps.policy.sdkVersion
  )
    return yield* Effect.fail(officeFailure("STALE_REVIEW"));
  const bundle = yield* readReviewBundle(deps, review);
  if (bundle.capture.state !== "complete" || bundle.readiness !== "ready")
    return yield* Effect.fail(officeFailure("STALE_REVIEW"));
  const draft = yield* deps.metadata.draft(review.owner, bundle.capture.draftId);
  const document = yield* deps.metadata.document(review.owner, review.documentId);
  if (
    draft === null ||
    document === null ||
    document.unitId !== review.unitId ||
    draft.worktreeId !== review.worktreeId ||
    draft.generation !== review.generation ||
    draft.documentId !== review.documentId ||
    (document.location === "main" ? document.document.revision : null) !== review.mainRevision
  )
    return yield* Effect.fail(officeFailure("STALE_REVIEW"));
  const target = {
    owner: review.owner,
    documentId: review.documentId,
    unitId: review.unitId,
    scope: { kind: "draft" as const, draftId: draft.id, generation: draft.generation },
  };
  const epoch = yield* deps.authority.current(review.owner, review.documentId);
  yield* Effect.scoped(
    Effect.gen(function* () {
      const pair = yield* deps.native({ kind: "read", target, ...epoch });
      const aggregate = yield* nativeCall(() =>
        pair.worktrees.getWorktree(
          { userID: review.owner.ownerId, customData: {}, request: {} },
          review.worktreeId,
        ),
      );
      const unit = aggregate?.units.find((value) => value.unitID === review.unitId);
      if (
        !aggregate ||
        aggregate.worktree.status !== "ready" ||
        !unit ||
        unit.type !== nativeTypes[document.document.kind] ||
        unit.draftHeadRevision !== review.draftRevision ||
        unit.readyDraftHeadRevision !== review.readyRevision ||
        (unit.baselineTrunkRevision ?? null) !== review.baselineRevision ||
        unit.source !== review.source ||
        (unit.removed === true) !== review.removed
      )
        return yield* Effect.fail(officeFailure("STALE_REVIEW"));
      return undefined;
    }),
  );
  const barrier = yield* deps.metadata.publicationBarrier(review.owner, review.documentId);
  if (barrier !== null) return yield* Effect.fail(officeFailure("BUSY"));
  return { bundle, draft, document, target };
});
