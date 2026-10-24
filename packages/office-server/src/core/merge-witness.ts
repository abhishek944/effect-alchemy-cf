import { Effect } from "effect";
import { decodeWire } from "@starter/office-contract";
import { encodeNativeFrame } from "@starter/office-contract/native-wire";
import type {
  FrozenReview,
  OfficeDependencies,
  OperationRecord,
  WritePermit,
} from "../ports/index.ts";
import {
  MergeWitness as MergeWitnessSchema,
  type MergeWitness as MergeWitnessType,
} from "../ports/index.ts";
import type { ISnapshotWithBlocks } from "@univerjs-pro/collaboration-service";
import { verifyOperation } from "./claims.ts";
import { readReviewBundle } from "./review-bundle.ts";
import { sameReviewResult } from "./review-comparison.ts";
import { loadNativeArtifact } from "./bytes.ts";
import { operationRecord } from "./operation-read.ts";
import { advanceOperation, terminalReceipt, sha256 } from "./operations.ts";
import { operationTarget } from "./operation-caller.ts";
import { confirmNativeWrites } from "./native-complete.ts";
import { nativeCall, officeFailure } from "./failure.ts";

export type { MergeWitness } from "../ports/index.ts";

/**
 * The operation record owns the witness. An operation staged before that compaction still
 * carries a ready merge-artifact ref, which is read but never written again.
 */
export const readMergeWitness = Effect.fn("Office.readMergeWitness")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
  review: FrozenReview,
) {
  let witness = record.merge;
  if (witness === null) {
    if (record.artifacts.proposal === null) return null;
    const raw = yield* loadNativeArtifact(
      deps,
      record.owner,
      record.artifacts.proposal,
      "merge-artifact",
    );
    witness = yield* decodeWire(MergeWitnessSchema)(raw).pipe(
      Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
    );
  }
  if (
    witness.operationId !== record.receipt.operationId ||
    witness.reviewId !== review.id ||
    witness.fingerprint !== review.fingerprint ||
    witness.previewDigest !== review.preview?.digest ||
    witness.native.unitID !== review.unitId ||
    (witness.outcome === "merged"
      ? witness.acceptedRevision !== witness.native.rev
      : witness.acceptedRevision !== null || witness.native.rev !== review.mainRevision)
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", record.receipt.operationId));
  return witness;
});
/** A durable proof of completed semantic verification, not authority to fetch native content later. */
export const stageMergeWitness = Effect.fn("Office.stageMergeWitness")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
  review: FrozenReview,
  native: ISnapshotWithBlocks,
  outcome: "merged" | "unchanged",
  acceptedRevision: number | null,
) {
  yield* verifyOperation(deps, record, yield* operationTarget(deps, record), "recovery-observe");
  const existing = yield* readMergeWitness(deps, record, review);
  if (existing !== null) return existing;
  const bundle = yield* readReviewBundle(deps, review);
  if (
    review.preview === null ||
    !(yield* nativeCall(() => sameReviewResult(bundle.capture, native, record.receipt.operationId)))
  )
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", record.receipt.operationId));
  const nativeDigest = yield* Effect.try({
    try: () => sha256(encodeNativeFrame("merge-artifact", native)),
    catch: () => officeFailure("LIMIT_EXCEEDED", record.receipt.operationId),
  });
  const value = yield* decodeWire(MergeWitnessSchema)({
    purpose: "office-merge-verified",
    version: 1,
    operationId: record.receipt.operationId,
    reviewId: review.id,
    fingerprint: review.fingerprint,
    previewDigest: review.preview.digest,
    outcome,
    acceptedRevision,
    native: {
      unitID: native.snapshot.unitID,
      type: native.snapshot.type,
      rev: native.snapshot.rev,
    },
    nativeDigest,
  }).pipe(Effect.mapError(() => officeFailure("CONTENT_REQUIRED")));
  const current = yield* operationRecord(deps, record.owner, record.receipt.operationId);
  if (current === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  yield* verifyOperation(deps, current, yield* operationTarget(deps, current), "recovery-observe");
  if (current.merge !== null || current.artifacts.proposal !== null)
    return yield* readMergeWitness(deps, current, review);
  yield* advanceOperation(deps, current, current.receipt.phase, { merge: value });
  return value;
});
export const finishWitnessedMerge = Effect.fn("Office.finishWitnessedMerge")(function* (
  deps: OfficeDependencies,
  record: OperationRecord,
  review: FrozenReview,
  permit: WritePermit,
  witness: MergeWitnessType,
) {
  yield* confirmNativeWrites(deps, record, permit);
  const current = yield* operationRecord(deps, record.owner, permit.operationId);
  if (current === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  yield* verifyOperation(deps, current, permit.target, "recovery-observe");
  if (terminalReceipt(current.receipt.phase)) return current.receipt;
  const receipt = {
    ...current.receipt,
    phase: "confirmed" as const,
    version: current.receipt.version + 1,
    reviewId: review.id,
    acceptedRevision: witness.acceptedRevision,
    error: null,
  };
  // Concrete final D1 batch independently proves real merged status/result/head and all original slots.
  yield* deps.metadata.finishPublication(permit, receipt);
  const saved = yield* operationRecord(deps, record.owner, permit.operationId);
  if (saved?.receipt.phase !== "confirmed")
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", permit.operationId));
  return saved.receipt;
});
