import { Effect, Schema } from "effect";
import { Change, Count, Id, Kind, Label, Revision, decodeWire } from "@starter/office-contract";
import type { FrozenReview, OfficeDependencies } from "../ports/index.ts";
import { SnapshotWithBlocksSchema } from "../jobs/snapshot-schema.ts";
import { loadNativeArtifact } from "./bytes.ts";
import { officeFailure } from "./failure.ts";
import { metadataDigest } from "./operations.ts";

export const reviewFingerprint = (review: Omit<FrozenReview, "fingerprint">): string =>
  metadataDigest(
    [
      "office-review",
      1,
      review.owner.stage,
      review.owner.ownerId,
      review.id,
      review.documentId,
      review.unitId,
      review.worktreeId,
      review.generation,
      review.baselineRevision,
      review.draftRevision,
      review.readyRevision,
      review.mainRevision,
      review.source,
      review.removed,
      review.destination.documentId,
      review.destination.unitId,
      review.destination.title,
      review.main?.id ?? null,
      review.baseline?.id ?? null,
      review.draft.id,
      review.result?.id ?? null,
      review.preview?.digest ?? null,
      review.sdkVersion,
      review.policyVersion,
    ],
    16384,
  );
const NativeId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
export const ReadyCapture = Schema.Struct({
  purpose: Schema.Literal("office-ready-capture"),
  version: Schema.Literal(1),
  operationId: Id,
  documentId: Id,
  draftId: Id,
  unitId: NativeId,
  worktreeId: NativeId,
  generation: Count,
  kind: Kind,
  source: Schema.Literals(["trunk", "worktree"]),
  removed: Schema.Boolean,
  baselineRevision: Schema.NullOr(Revision),
  readyRevision: Revision,
  mainRevision: Schema.NullOr(Revision),
  main: Schema.NullOr(SnapshotWithBlocksSchema),
  baseline: Schema.NullOr(SnapshotWithBlocksSchema),
  draft: SnapshotWithBlocksSchema,
  result: Schema.NullOr(SnapshotWithBlocksSchema),
  state: Schema.Literals(["complete", "incomplete", "conflict"]),
  fidelity: Schema.Literals(["history", "snapshot"]),
  // The public comparison engine accepts unknown history metadata and owns its product interpretation.
  // These are binary actual SDK results, never application metadata or reconstructed changesets.
  leftChangesets: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(16384)),
  rightChangesets: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(16384)),
});
export type ReadyCapture = typeof ReadyCapture.Type;
/** Full normalized comparison is private and immutable; public API pages are bounded separately. */
export const ReviewBundle = Schema.Struct({
  purpose: Schema.Literal("office-review-bundle"),
  version: Schema.Literal(1),
  capture: ReadyCapture,
  changes: Schema.Array(Change).check(Schema.isMaxLength(100000)),
  totalChanges: Count,
  fidelity: Schema.Literals(["history", "snapshot"]),
  readiness: Schema.Literals(["ready", "degraded"]),
  diagnostics: Schema.Array(Label).check(Schema.isMaxLength(32)),
});
export type ReviewBundle = typeof ReviewBundle.Type;
export const readReviewBundle = Effect.fn("Office.readReviewBundle")(function* (
  deps: OfficeDependencies,
  review: FrozenReview,
) {
  if (reviewFingerprint(review) !== review.fingerprint)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  const ref = review.preview;
  if (ref === null || ref.kind !== "native-preview")
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  const raw = yield* loadNativeArtifact(deps, review.owner, ref, "job-output");
  const bundle = yield* decodeWire(ReviewBundle)(raw).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
  const capture = bundle.capture;
  if (
    bundle.totalChanges !== bundle.changes.length ||
    capture.documentId !== review.documentId ||
    capture.unitId !== review.unitId ||
    capture.worktreeId !== review.worktreeId ||
    capture.generation !== review.generation ||
    capture.baselineRevision !== review.baselineRevision ||
    capture.readyRevision !== review.readyRevision ||
    capture.mainRevision !== review.mainRevision ||
    capture.source !== review.source ||
    capture.removed !== review.removed ||
    capture.kind !== review.draft.kind ||
    capture.draft.snapshot.unitID !== review.unitId ||
    capture.draft.snapshot.rev !== review.draftRevision ||
    (review.result !== null && capture.result?.snapshot.rev !== review.result.revision)
  )
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  return bundle;
});
