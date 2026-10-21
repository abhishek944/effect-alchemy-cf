import type { IDatabaseAdapter } from "@univerjs-pro/collaboration-service";
import type { IWorktreeDatabaseAdapter } from "@univerjs-pro/collaboration-worktree-service";
import type { NativeLeaseContext } from "./native-lease.ts";
import { officeFailure } from "./failure.ts";

/** Private, document-bound SDK lifetime adapter. Current invocation is never a mutable global. */
export function createCoreDispatch(context: NativeLeaseContext): IDatabaseAdapter {
  return {
    getUnit: (ctx, id) => context.current(ctx.userID, id).pair.core.getUnit(ctx, id),
    getSnapshotInfo: (ctx, id, options) =>
      context.current(ctx.userID, id).pair.core.getSnapshotInfo(ctx, id, options),
    getSnapshot: (ctx, id, options) =>
      context.current(ctx.userID, id).pair.core.getSnapshot(ctx, id, options),
    getSheetBlock: (ctx, id, block) =>
      context.current(ctx.userID, id).pair.core.getSheetBlock(ctx, id, block),
    getChangesets: (ctx, id, range) =>
      context.current(ctx.userID, id).pair.core.getChangesets(ctx, id, range),
    createUnit: (ctx, input) => {
      context.current(ctx.userID, input.record.unitID);
      return context.write(ctx.userID, { kind: "core-create", input }, (pair) =>
        pair.core.createUnit(ctx, input),
      );
    },
    commitChangeset: (ctx, input) => {
      context.current(ctx.userID, input.changeset.unitID);
      return context.write(ctx.userID, { kind: "core-commit", input }, (pair) =>
        pair.core.commitChangeset(ctx, input),
      );
    },
    saveSnapshot: (ctx, input) => {
      context.current(ctx.userID, input.snapshot.unitID);
      return context.write(ctx.userID, { kind: "core-snapshot", input }, (pair) =>
        pair.core.saveSnapshot(ctx, input),
      );
    },
    deleteUnits: () => Promise.reject(officeFailure("FORBIDDEN")),
    recoverUnits: () => Promise.reject(officeFailure("FORBIDDEN")),
  };
}
export function createWorktreeDispatch(context: NativeLeaseContext): IWorktreeDatabaseAdapter {
  const read = (user: string, id: string, unit?: string) =>
    context.current(user, unit, id).pair.worktrees;
  return {
    getWorktree: (ctx, id) => read(ctx.userID, id).getWorktree(ctx, id),
    getWorktreeUnit: (ctx, id, unit) => read(ctx.userID, id, unit).getWorktreeUnit(ctx, id, unit),
    getDraftChangesets: (ctx, id, unit, range) =>
      read(ctx.userID, id, unit).getDraftChangesets(ctx, id, unit, range),
    getUnitSeed: (ctx, id, unit) => read(ctx.userID, id, unit).getUnitSeed(ctx, id, unit),
    getUnitMergeArtifact: (ctx, id, unit) =>
      read(ctx.userID, id, unit).getUnitMergeArtifact(ctx, id, unit),
    createWorktree: (ctx, input) => {
      context.current(ctx.userID, undefined, input.record.worktreeID);
      if (
        input.units.some((unit) => unit.unitID !== context.target.unitId) ||
        input.units.length > 1
      )
        throw officeFailure("FORBIDDEN");
      return context.write(ctx.userID, { kind: "worktree-create", input }, (pair) =>
        pair.worktrees.createWorktree(ctx, input),
      );
    },
    addUnit: (ctx, input) => {
      context.current(ctx.userID, input.unit.unitID, input.unit.worktreeID);
      return context.write(ctx.userID, { kind: "worktree-add", input }, (pair) =>
        pair.worktrees.addUnit(ctx, input),
      );
    },
    createUnit: (ctx, input) => {
      context.current(ctx.userID, input.unit.unitID, input.unit.worktreeID);
      return context.write(ctx.userID, { kind: "draft-create", input }, (pair) =>
        pair.worktrees.createUnit(ctx, input),
      );
    },
    saveUnitMergeArtifact: (ctx, input) => {
      context.current(ctx.userID, input.unitID, input.worktreeID);
      return context.write(ctx.userID, { kind: "draft-artifact", input }, (pair) =>
        pair.worktrees.saveUnitMergeArtifact(ctx, input),
      );
    },
    commitDraftChangeset: (ctx, input) => {
      context.current(ctx.userID, input.changeset.unitID, input.worktreeID);
      return context.write(ctx.userID, { kind: "draft-commit", input }, (pair) =>
        pair.worktrees.commitDraftChangeset(ctx, input),
      );
    },
    setUnitRemoved: (ctx, input) => {
      context.current(ctx.userID, input.unitID, input.worktreeID);
      return context.write(ctx.userID, { kind: "worktree-remove", input }, (pair) =>
        pair.worktrees.setUnitRemoved(ctx, input),
      );
    },
    recordUnitMergeResult: (ctx, input) => {
      context.current(ctx.userID, input.unitID, input.worktreeID);
      return context.write(ctx.userID, { kind: "worktree-result", input }, (pair) =>
        pair.worktrees.recordUnitMergeResult(ctx, input),
      );
    },
    markReady: (ctx, worktreeId) => {
      context.current(ctx.userID, undefined, worktreeId);
      return context.write(
        ctx.userID,
        { kind: "worktree-transition", action: "markReady", worktreeId },
        (pair) => pair.worktrees.markReady(ctx, worktreeId),
      );
    },
    reopenWorktree: (ctx, worktreeId) => {
      context.current(ctx.userID, undefined, worktreeId);
      return context.write(
        ctx.userID,
        { kind: "worktree-transition", action: "reopenWorktree", worktreeId },
        (pair) => pair.worktrees.reopenWorktree(ctx, worktreeId),
      );
    },
    discardWorktree: (ctx, worktreeId) => {
      context.current(ctx.userID, undefined, worktreeId);
      return context.write(
        ctx.userID,
        { kind: "worktree-transition", action: "discardWorktree", worktreeId },
        (pair) => pair.worktrees.discardWorktree(ctx, worktreeId),
      );
    },
    startOrResumeMerge: (ctx, worktreeId) => {
      context.current(ctx.userID, undefined, worktreeId);
      return context.write(
        ctx.userID,
        { kind: "worktree-transition", action: "startOrResumeMerge", worktreeId },
        (pair) => pair.worktrees.startOrResumeMerge(ctx, worktreeId),
      );
    },
    finishMerge: (ctx, worktreeId) => {
      context.current(ctx.userID, undefined, worktreeId);
      return context.write(
        ctx.userID,
        { kind: "worktree-transition", action: "finishMerge", worktreeId },
        (pair) => pair.worktrees.finishMerge(ctx, worktreeId),
      );
    },
  };
}
