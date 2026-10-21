import { Effect } from "effect";
import { safeFailure } from "@starter/office-contract";
import type { WorktreeData } from "@univerjs-pro/collaboration-worktree-service";
import type {
  FrozenReview,
  OfficeDependencies,
  OperationRecord,
  WritePermit,
} from "../ports/index.ts";
import type { ISnapshotWithBlocks } from "@univerjs-pro/collaboration-service";
import { operationRecord } from "./operation-read.ts";
import { advanceOperation, terminalReceipt } from "./operations.ts";
import { confirmNativeWrites } from "./native-complete.ts";
import { stageMergeWitness, finishWitnessedMerge } from "./merge-witness.ts";
import { officeFailure } from "./failure.ts";

export const finishMerge = Effect.fn("Office.finishMerge")(function* (
  deps: OfficeDependencies,
  original: OperationRecord,
  review: FrozenReview,
  permit: WritePermit,
  worktree: WorktreeData,
  actual: ISnapshotWithBlocks | null,
) {
  const unit = worktree.units.find((value) => value.unitID === original.unitId);
  const outcome = unit?.mergeResult;
  if (
    worktree.worktreeID !== original.worktreeId ||
    worktree.status !== "merged" ||
    outcome === undefined ||
    !["merged", "unchanged", "removed"].includes(outcome.status)
  )
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", permit.operationId));
  if ((outcome.status !== "merged" && outcome.status !== "unchanged") || actual === null)
    return yield* Effect.fail(officeFailure("NOT_EDITABLE", permit.operationId));
  yield* confirmNativeWrites(deps, original, permit);
  const witness = yield* stageMergeWitness(
    deps,
    original,
    review,
    actual,
    outcome.status,
    outcome.status === "merged" ? outcome.trunkRevision : null,
  );
  if (witness === null)
    return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN", permit.operationId));
  return yield* finishWitnessedMerge(deps, original, review, permit, witness);
});
export const mergeAttention = Effect.fn("Office.mergeAttention")(function* (
  deps: OfficeDependencies,
  original: OperationRecord,
  review: FrozenReview,
  permit: WritePermit,
) {
  let current = yield* operationRecord(deps, original.owner, permit.operationId);
  if (current === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  if (terminalReceipt(current.receipt.phase)) return current.receipt;
  if (current.receipt.phase === "needs-attention") return current.receipt;
  if (current.receipt.phase === "admitted")
    current = yield* advanceOperation(deps, current, "publishing");
  const receipt = {
    ...current.receipt,
    phase: "needs-attention" as const,
    version: current.receipt.version + 1,
    reviewId: review.id,
    error: safeFailure("OUTCOME_UNKNOWN", permit.operationId),
  };
  yield* deps.metadata.finishPublication(permit, receipt);
  return receipt;
});
