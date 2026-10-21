import type { FrozenReview } from "../ports/records.ts";

/** Existing fingerprint bytes, shared without Node hashing or an authority grant. */
export const reviewFingerprintInput = (
  review: Omit<FrozenReview, "fingerprint">,
): readonly unknown[] => [
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
];
