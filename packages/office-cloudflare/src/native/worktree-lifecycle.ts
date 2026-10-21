import { readRemoved, readMergeInput } from "./record-shapes.ts";
import { readMergeResultJSON } from "./row-codecs.ts";
import type {
  IWorktreeDatabaseAdapter,
  WorktreeStatus,
} from "@univerjs-pro/collaboration-worktree-service";
import type { NativeDatabase } from "./database.ts";
import type { NativeStatement } from "./database.ts";
import { metadata, NativeStorageError } from "./types.ts";
import { aggregate, readDraft, readWorktree } from "./records.ts";
import { requireDraftFence, checkWorktree, currentAggregate } from "./worktree-state.ts";

type Lifecycle = Pick<
  IWorktreeDatabaseAdapter,
  | "markReady"
  | "reopenWorktree"
  | "discardWorktree"
  | "startOrResumeMerge"
  | "recordUnitMergeResult"
  | "finishMerge"
  | "setUnitRemoved"
>;
export function createWorktreeLifecycle(db: NativeDatabase): Lifecycle {
  const transition = async (
    id: string,
    target: WorktreeStatus,
    allowed: readonly WorktreeStatus[],
  ) => {
    checkWorktree(db, id);
    const row = await readWorktree(db, id);
    const state = await aggregate(db, id);
    if (!row || !state) return { status: "not-found" } as const;
    if (row.status === target) return { status: "already-in-target", aggregate: state } as const;
    if (!allowed.includes(row.status))
      return { status: "status-mismatch", aggregate: state } as const;
    const statements: NativeStatement[] = [
      [
        "UPDATE office_native_worktrees SET status=?,generation=? WHERE scope=? AND id=?",
        [target, row.generation + Number(target === "draft"), db.key, id],
      ],
    ];
    if (target === "ready")
      statements.push([
        "UPDATE office_native_drafts SET ready=head WHERE scope=? AND worktree=?",
        [db.key, id],
      ]);
    if (target === "draft")
      statements.push([
        "UPDATE office_native_drafts SET ready=NULL,artifact=NULL,artifact_ready=NULL WHERE scope=? AND worktree=?",
        [db.key, id],
      ]);
    let predicate =
      "EXISTS(SELECT 1 FROM office_native_worktrees WHERE scope=? AND id=? AND status=? AND generation=?)";
    const bindings: (string | number | null)[] = [db.key, id, row.status, row.generation];
    if (target === "merged") {
      predicate += ` AND NOT EXISTS(SELECT 1 FROM office_native_drafts WHERE scope=? AND worktree=?
        AND (merge_result IS NULL OR json_extract(merge_result,'$.status') NOT IN ('merged','unchanged','removed')))`;
      bindings.push(db.key, id);
    }
    await db.write(
      `transition:${id}:${row.generation}:${target}`,
      { id, target, previous: row.status },
      statements,
      predicate,
      bindings,
    );
    db.fence = {
      ...db.fence,
      draft: {
        ...requireDraftFence(db),
        status: target,
        generation: row.generation + Number(target === "draft"),
      },
    };
    return {
      status: "transitioned",
      previousStatus: row.status,
      aggregate: await currentAggregate(db, id),
    } as const;
  };
  return {
    async markReady(context, id) {
      db.check(context.userID);
      return transition(id, "ready", ["draft"]);
    },
    async reopenWorktree(context, id) {
      db.check(context.userID);
      return transition(id, "draft", ["ready"]);
    },
    async discardWorktree(context, id) {
      db.check(context.userID);
      return transition(id, "discarded", ["draft", "ready"]);
    },
    async finishMerge(context, id) {
      db.check(context.userID);
      checkWorktree(db, id);
      const state = await aggregate(db, id);
      if (
        state?.units.some(
          (u) =>
            !u.mergeResult || !["merged", "unchanged", "removed"].includes(u.mergeResult.status),
        )
      ) {
        return { status: "status-mismatch", aggregate: state };
      }
      return transition(id, "merged", ["merging"]);
    },
    async startOrResumeMerge(context, id) {
      db.check(context.userID);
      checkWorktree(db, id);
      const state = await aggregate(db, id);
      if (!state) return { status: "not-found" };
      if (state.worktree.status === "merged") return { status: "already-merged", aggregate: state };
      if (state.worktree.status === "merging") return { status: "resumed", aggregate: state };
      const result = await transition(id, "merging", ["ready"]);
      if (result.status === "not-found" || result.status === "status-mismatch") return result;
      if (result.status === "already-in-target")
        return { status: "resumed", aggregate: result.aggregate };
      return { status: "started", aggregate: result.aggregate };
    },
    async setUnitRemoved(context, raw) {
      const input = readRemoved(raw);
      db.check(context.userID, input.unitID);
      checkWorktree(db, input.worktreeID);
      const state = await aggregate(db, input.worktreeID);
      const unit = state?.units[0];
      if (!state || !unit) return { status: "not-found" };
      if (state.worktree.status !== "draft" || unit.mergeResult)
        return { status: "not-editable", aggregate: state };
      if (Boolean(unit.removed) === input.removed) return { status: "unchanged", aggregate: state };
      await db.write(
        `removed:${input.worktreeID}:${requireDraftFence(db).generation}:${Number(input.removed)}`,
        input,
        [
          [
            "UPDATE office_native_drafts SET removed=? WHERE scope=? AND worktree=?",
            [Number(input.removed), db.key, input.worktreeID],
          ],
        ],
        `EXISTS(SELECT 1 FROM office_native_drafts WHERE scope=? AND worktree=? AND merge_result IS NULL)`,
        [db.key, input.worktreeID],
      );
      db.fence = { ...db.fence, draft: { ...requireDraftFence(db), removed: input.removed } };
      return { status: "updated", aggregate: await currentAggregate(db, input.worktreeID) };
    },
    async recordUnitMergeResult(context, raw) {
      const input = readMergeInput(raw);
      db.check(context.userID, input.unitID);
      checkWorktree(db, input.worktreeID);
      const row = await readWorktree(db, input.worktreeID);
      const unit = await readDraft(db, input.worktreeID);
      if (!row || !unit) return { status: "not-found" };
      if (row.status !== "merging" || unit.ready !== input.readyDraftHeadRevision)
        return { status: "stale-merge" };
      const result = metadata(input.mergeResult);
      const existing = unit.merge_result ? readMergeResultJSON(unit.merge_result) : null;
      if (existing && ["merged", "unchanged", "removed"].includes(existing.status)) {
        if (unit.merge_result !== result)
          throw new NativeStorageError("CONFLICT", "Terminal merge result cannot change");
        return {
          status: "already-recorded",
          aggregate: await currentAggregate(db, input.worktreeID),
        };
      }
      await db.write(
        `merge-result:${input.worktreeID}:${input.readyDraftHeadRevision}`,
        input,
        [
          [
            "UPDATE office_native_drafts SET merge_result=? WHERE scope=? AND worktree=?",
            [result, db.key, input.worktreeID],
          ],
        ],
        "EXISTS(SELECT 1 FROM office_native_drafts WHERE scope=? AND worktree=? AND ready=? AND merge_result IS ?)",
        [db.key, input.worktreeID, input.readyDraftHeadRevision, unit.merge_result],
      );
      return { status: "recorded", aggregate: await currentAggregate(db, input.worktreeID) };
    },
  };
}
