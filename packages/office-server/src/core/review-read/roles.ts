import { Clock, Effect, Schema } from "effect";
import { View, decodeWire } from "@starter/office-contract";
import type { Actor, FrozenReview, OfficeDependencies, ViewRecord } from "../../ports/index.ts";
import { snapshotDigest } from "../../jobs/frames.ts";
import { SnapshotWithBlocksSchema } from "../../jobs/snapshot-schema.ts";
import { loadNativeArtifact } from "../bytes.ts";
import { sameOwner } from "../claims.ts";
import { officeFailure } from "../failure.ts";
import { boundedMetadataDigest } from "../operations.ts";
import type { ReviewBundle } from "../review-bundle.ts";
import { lookupView } from "../views.ts";
import { nativeTypes } from "../target.ts";

type Role = "main" | "baseline" | "draft" | "result";
const roles: readonly Role[] = ["main", "baseline", "draft", "result"];
export type RoleBinding = { readonly role: Role; readonly record: ViewRecord };
const equalView = Schema.toEquivalence(View);
export const requireLifetime = Effect.fn("Office.reviewRead.lifetime")(function* (
  review: FrozenReview,
) {
  const now = yield* Clock.currentTimeMillis;
  if (review.expiresAt <= now || roles.some((role) => (review[role]?.expiresAt ?? Infinity) <= now))
    return yield* Effect.fail(officeFailure("STALE_REVIEW"));
  return undefined;
});

/** Reuse the producer's exact persisted roles; never create or renew a View while reading pages. */
export const readRoles = Effect.fn("Office.reviewRead.roles")(function* (
  deps: OfficeDependencies,
  actor: Actor,
  review: FrozenReview,
  bundle: ReviewBundle,
  verifyContent: boolean,
) {
  yield* requireLifetime(review);
  const bindings: RoleBinding[] = [];
  for (const role of roles) {
    const expected = review[role],
      native = bundle.capture[role];
    if ((expected === null) !== (native === null))
      return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
    if (expected === null || native === null) continue;
    const view = yield* decodeWire(View)(expected).pipe(
      Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
    );
    const record = yield* lookupView(deps, actor, view.id);
    const scope = record.target.scope;
    const main = role === "main" || role === "baseline";
    if (
      !sameOwner(record.owner, review.owner) ||
      !sameOwner(record.target.owner, review.owner) ||
      record.target.documentId !== review.documentId ||
      record.target.unitId !== review.unitId ||
      view.documentId !== review.documentId ||
      view.kind !== bundle.capture.kind ||
      view.nativeTarget.kind !== "pinned-snapshot" ||
      view.nativeTarget.unitId !== review.unitId ||
      view.mode !== "read-only" ||
      view.revision !== native.snapshot.rev ||
      native.snapshot.unitID !== review.unitId ||
      native.snapshot.type !== nativeTypes[bundle.capture.kind] ||
      view.expiresAt < review.expiresAt ||
      record.view.expiresAt < view.expiresAt ||
      !equalView({ ...record.view, expiresAt: view.expiresAt }, view) ||
      (main
        ? scope.kind !== "main"
        : scope.kind !== "draft" ||
          scope.draftId !== bundle.capture.draftId ||
          scope.generation !== review.generation) ||
      record.source.kind !== "artifact"
    )
      return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
    if (verifyContent) {
      const raw = yield* loadNativeArtifact(
        deps,
        review.owner,
        record.source.artifact,
        "merge-artifact",
      );
      const stored = yield* decodeWire(SnapshotWithBlocksSchema)(raw).pipe(
        Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
      );
      yield* Effect.try({
        try: () => {
          if (snapshotDigest(stored) !== snapshotDigest(native))
            throw officeFailure("CONTENT_REQUIRED");
        },
        catch: () => officeFailure("CONTENT_REQUIRED"),
      });
    }
    bindings.push({ role, record });
  }
  return bindings;
});

/** Bind pagination to the frozen fingerprint and exact role/source/epoch vector, not an offset alone. */
export const pageIdentity = (
  deps: OfficeDependencies,
  review: FrozenReview,
  bindings: readonly RoleBinding[],
) =>
  boundedMetadataDigest(
    [
      "office-review-page",
      1,
      review,
      bindings.map(({ role, record }) => [
        role,
        { ...record, view: { ...record.view, expiresAt: 0 } },
      ]),
    ],
    deps.policy.limits.metadataBytes,
  );

export function requireLeafRoles(review: FrozenReview, bundle: ReviewBundle): void {
  const ids = new Set<string>();
  const before = review.main?.id ?? review.draft.id,
    after = review.result?.id ?? review.draft.id;
  for (const change of bundle.changes) {
    if (ids.has(change.id)) throw officeFailure("CONTENT_REQUIRED");
    ids.add(change.id);
    for (const leaf of change.leaves) {
      if (
        (leaf.before.kind === "native-view" && leaf.before.viewId !== before) ||
        (leaf.after.kind === "native-view" && leaf.after.viewId !== after)
      )
        throw officeFailure("CONTENT_REQUIRED");
    }
  }
}
