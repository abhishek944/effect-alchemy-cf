import { Effect } from "effect";
import type {
  Actor,
  FrozenReview,
  OfficeDependencies,
  OperationRecord,
  WritePermit,
} from "../ports/index.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";
import { readReviewBundle } from "./review-bundle.ts";
import { nativeWrites } from "./native-complete.ts";
import { observeNativeWrite, originalWriteTarget } from "./write-observation.ts";
import { readMergeWitness, finishWitnessedMerge } from "./merge-witness.ts";
import { authorize, verifyOperation } from "./claims.ts";
import { materializeNativeSnapshot } from "./input.ts";
import { finishMerge, mergeAttention } from "./merge-finish.ts";

/** Observation/metadata repair only. Partial SDK work stays attention; no ambiguous native leaf is replayed. */
export const observeMerge = Effect.fn("Office.observeMerge")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  actor: Actor,
  record: OperationRecord,
  review: FrozenReview,
  permit: WritePermit,
) {
  yield* verifyOperation(deps, record, permit.target, "recovery-observe");
  const writes = yield* nativeWrites(deps, record);
  if (writes.length === 0) return record.receipt;
  for (const write of writes) {
    const proof = yield* observeNativeWrite(
      deps,
      record,
      originalWriteTarget(record, write),
      write,
    );
    if (proof.state !== "confirmed") return yield* mergeAttention(deps, record, review, permit);
  }
  const witness = yield* readMergeWitness(deps, record, review);
  if (witness !== null) return yield* finishWitnessedMerge(deps, record, review, permit, witness);
  // New content reads require a genuinely fresh human read grant, never a Recovery actor in disguise.
  if (actor.capability !== "human") return yield* mergeAttention(deps, record, review, permit);
  yield* authorize(deps, actor, "read", permit.target, permit.operationId);
  const epoch = { authorityEpoch: permit.authorityEpoch, serviceEpoch: permit.serviceEpoch };
  const worktree = yield* runtime.invoke(
    { kind: "read", target: permit.target, ...epoch },
    review.worktreeId,
    "read",
    null,
    async (services) =>
      (
        await services.drafts.getWorktree(
          { worktreeID: review.worktreeId },
          { userID: record.owner.ownerId },
        )
      ).worktree,
  );
  const unit = worktree.units.find((value) => value.unitID === record.unitId);
  if (
    worktree.status !== "merged" ||
    !unit?.mergeResult ||
    !["merged", "unchanged", "removed"].includes(unit.mergeResult.status)
  )
    return yield* mergeAttention(deps, record, review, permit);
  const revision =
    unit.mergeResult.status === "merged"
      ? unit.mergeResult.trunkRevision
      : unit.mergeResult.status === "unchanged"
        ? review.mainRevision
        : null;
  const bundle = yield* readReviewBundle(deps, review);
  const main = {
    owner: record.owner,
    documentId: record.documentId,
    unitId: record.unitId,
    scope: { kind: "main" as const },
  };
  if (revision !== null) yield* authorize(deps, actor, "read", main, permit.operationId);
  const actual =
    revision === null
      ? null
      : yield* materializeNativeSnapshot(
          deps,
          runtime,
          { kind: "read", target: main, ...epoch },
          null,
          bundle.capture.kind,
          revision,
        );
  return yield* finishMerge(deps, record, review, permit, worktree, actual);
});
