import { Clock, Effect, Schema } from "effect";
import { Cursor, Id, ReviewPage, decodeWire } from "@starter/office-contract";
import type { Actor, OfficeDependencies, OfficeService } from "../../ports/index.ts";
import { authorize, sameOwner } from "../claims.ts";
import { officeFailure } from "../failure.ts";
import type { OfficeNativeRuntime } from "../native-runtime.ts";
import { readReviewBundle } from "../review-bundle.ts";
import { assertReviewCurrent } from "../review-state.ts";
import { lookupView } from "../views.ts";
import { pageIdentity, readRoles, requireLeafRoles, requireLifetime } from "./roles.ts";
import { projectPage, readOffset } from "./page.ts";

const Request = Schema.Struct({ reviewId: Id, cursor: Cursor });
const readReview = Effect.fn("Office.reviewRead")(function* (
  deps: OfficeDependencies,
  actor: Actor,
  reviewId: string,
  cursor: string | null,
) {
  const input = yield* decodeWire(Request)({ reviewId, cursor }).pipe(
    Effect.mapError(() => officeFailure("INVALID_INPUT")),
  );
  const claims = yield* authorize(deps, actor, "read", null);
  const review = yield* deps.metadata.review(claims.owner, input.reviewId);
  if (review === null || review.id !== input.reviewId || !sameOwner(review.owner, claims.owner))
    return yield* Effect.fail(officeFailure("NOT_FOUND"));
  yield* requireLifetime(review);
  const draft = yield* lookupView(deps, actor, review.draft.id);
  if (
    draft.target.documentId !== review.documentId ||
    draft.target.unitId !== review.unitId ||
    draft.target.scope.kind !== "draft" ||
    draft.target.scope.generation !== review.generation
  )
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  const bundle = yield* readReviewBundle(deps, review);
  const expectedState =
    bundle.capture.state === "conflict"
      ? "conflict"
      : bundle.capture.state === "complete" && bundle.readiness === "ready"
        ? "complete"
        : "incomplete";
  if (review.state !== expectedState) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  yield* Effect.try({
    try: () => requireLeafRoles(review, bundle),
    catch: () => officeFailure("CONTENT_REQUIRED"),
  });
  const bindings = yield* readRoles(deps, actor, review, bundle, true);
  const identity = yield* pageIdentity(deps, review, bindings);
  const offset = yield* Effect.try({
    try: () => readOffset(input.cursor, identity, bundle.totalChanges),
    catch: () => officeFailure("INVALID_INPUT"),
  });
  const page = yield* Effect.try({
    try: () => projectPage(deps.policy.limits.responseBytes, review, bundle, identity, offset),
    catch: () => officeFailure("LIMIT_EXCEEDED"),
  });
  // Re-read exact metadata after artifact IO; immutable role content need not be decoded twice.
  const latest = yield* deps.metadata.review(claims.owner, input.reviewId);
  if (latest === null || (yield* pageIdentity(deps, latest, bindings)) !== identity)
    return yield* Effect.fail(officeFailure("STALE_REVIEW"));
  const current = yield* readRoles(deps, actor, review, bundle, false);
  if ((yield* pageIdentity(deps, review, current)) !== identity)
    return yield* Effect.fail(officeFailure("STALE_REVIEW"));
  let approval: ReviewPage["approval"] = review.state === "conflict" ? "conflict" : "incomplete";
  if (
    review.state === "complete" &&
    bundle.readiness === "ready" &&
    bundle.diagnostics.length === 0
  ) {
    approval = yield* assertReviewCurrent(deps, review).pipe(
      Effect.map((): ReviewPage["approval"] => "available"),
      Effect.catch((error) =>
        error.code === "STALE_REVIEW"
          ? Effect.succeed<ReviewPage["approval"]>("stale")
          : error.code === "BUSY"
            ? Effect.succeed<ReviewPage["approval"]>("incomplete")
            : Effect.fail(error),
      ),
    );
  }
  const epoch = yield* deps.authority.current(review.owner, review.documentId);
  if (
    current.some(
      ({ record }) =>
        record.authorityEpoch !== epoch.authorityEpoch ||
        record.serviceEpoch !== epoch.serviceEpoch,
    )
  )
    return yield* Effect.fail(officeFailure("AUTHORITY_LOST"));
  const fresh = yield* authorize(deps, actor, "read", draft.target);
  yield* requireLifetime(review);
  if (fresh.expiresAt <= (yield* Clock.currentTimeMillis))
    return yield* Effect.fail(officeFailure("UNAUTHENTICATED"));
  return yield* decodeWire(ReviewPage)({ ...page, approval }).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
});

/** Existing helper owns native acquisition; the injected runtime remains owned by the caller. */
export function makeOfficeReviewRead(
  deps: OfficeDependencies,
  _runtime: OfficeNativeRuntime,
): Pick<OfficeService, "review"> {
  return { review: (actor, id, cursor) => readReview(deps, actor, id, cursor) };
}
