import { Effect } from "effect";
import type {
  FrozenReview,
  OfficeDependencies,
  OperationRecord,
  WritePermit,
} from "../ports/index.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";
import { readReviewBundle } from "./review-bundle.ts";
import { verifyOperation } from "./claims.ts";
import { makeNativeJournal } from "./native-journal.ts";
import { materializeRevision } from "./native-materialize.ts";
import { metadataDigest } from "./operations.ts";
import { nativeTypes } from "./target.ts";
import { finishMerge, mergeAttention } from "./merge-finish.ts";

/** The owning SDK performs formal semantic merge. Never apply a replacement snapshot or rerun generated code. */
export const submitMerge = Effect.fn("Office.submitMerge")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  record: OperationRecord,
  review: FrozenReview,
  permit: WritePermit,
  phase: "final-commit" | "recovery-dispatch",
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const bundle = yield* readReviewBundle(deps, review);
      yield* verifyOperation(deps, record, permit.target, phase);
      const memberID = metadataDigest(
        ["office-merge-member", 1, record.owner.stage, record.owner.ownerId, permit.operationId],
        4096,
      );
      const journal = yield* makeNativeJournal(
        deps,
        record,
        permit,
        nativeTypes[bundle.capture.kind],
        phase,
      );
      const result = yield* runtime.invoke(
        { kind: "write", permit },
        review.worktreeId,
        "merge",
        journal,
        async (services) => {
          const merged = await services.drafts.mergeWorktree(
            { worktreeID: review.worktreeId },
            { userID: record.owner.ownerId, memberID },
          );
          const unit = merged.worktree.units.find((value) => value.unitID === review.unitId);
          const revision =
            unit?.mergeResult?.status === "merged"
              ? unit.mergeResult.trunkRevision
              : unit?.mergeResult?.status === "unchanged"
                ? review.mainRevision
                : null;
          const actual =
            revision === null
              ? null
              : await materializeRevision(
                  services,
                  record.owner.ownerId,
                  review.unitId,
                  null,
                  bundle.capture.kind,
                  revision,
                  deps.policy.limits,
                );
          return { worktree: merged.worktree, actual };
        },
      );
      yield* verifyOperation(deps, record, permit.target, "recovery-observe");
      return yield* finishMerge(deps, record, review, permit, result.worktree, result.actual);
    }),
  ).pipe(Effect.catch(() => mergeAttention(deps, record, review, permit)));
});
