import { readCreateWorktree, readWorktreeUnit } from "./record-shapes.ts";
import { readPieceJSON } from "./row-codecs.ts";
import type {
  IWorktreeDatabaseAdapter,
  WorktreeUnitSeed,
} from "@univerjs-pro/collaboration-worktree-service";
import type { NativeDatabase } from "./database.ts";
import type { NativeStatement } from "./database.ts";
import type { NativePayloads } from "./payloads.ts";
import type { NativeWorktreeReferences } from "./worktree-refs.ts";
import { createWorktreeLifecycle } from "./worktree-lifecycle.ts";
import {
  aggregate,
  assertAuthority,
  draftRecord,
  history,
  readDraft,
  readWorktree,
} from "./records.ts";
import {
  requireDraftFence,
  assertTrunkUnit,
  checkWorktree,
  currentAggregate,
  draftInsert,
} from "./worktree-state.ts";
import { visibleDraft } from "./read-visibility.ts";
import { boundedID, NativeStorageError } from "./types.ts";

export function createNativeWorktreeDatabaseAdapter(
  db: NativeDatabase,
  payloads: NativePayloads,
  refs: NativeWorktreeReferences,
): IWorktreeDatabaseAdapter {
  return {
    ...createWorktreeLifecycle(db),
    async getWorktree(context, id) {
      db.check(context.userID);
      boundedID(id);
      return aggregate(db, id);
    },
    async getWorktreeUnit(context, id, unitID) {
      db.check(context.userID, unitID);
      boundedID(id);
      const row = await readDraft(db, id);
      return row ? draftRecord(db, id, row) : null;
    },
    async getDraftChangesets(context, id, unitID, range) {
      db.check(context.userID, unitID);
      boundedID(id);
      const row = await visibleDraft(db, id);
      return row ? history(db, payloads, id, row.head, range) : null;
    },
    async getUnitSeed(context, id, unitID) {
      db.check(context.userID, unitID);
      boundedID(id);
      const row = await visibleDraft(db, id);
      return row?.seed ? payloads.readSnapshot(readPieceJSON(row.seed)) : null;
    },
    async getUnitMergeArtifact(context, id, unitID) {
      db.check(context.userID, unitID);
      boundedID(id);
      const row = await visibleDraft(db, id);
      if (!row?.artifact || row.artifact_ready === null) return null;
      return {
        readyDraftHeadRevision: row.artifact_ready,
        unit: await payloads.readSnapshot(readPieceJSON(row.artifact)),
      };
    },
    async createWorktree(context, raw) {
      const input = readCreateWorktree(raw);
      db.check(context.userID);
      const id = input.record.worktreeID;
      checkWorktree(db, id, true);
      const existing = await aggregate(db, id);
      if (existing) return { status: "already-exists", aggregate: existing };
      if (input.record.status !== "draft" || input.units.length > 1)
        throw new NativeStorageError("SCOPE", "One draft document per Worktree");
      boundedID(input.record.sid);
      const statements: NativeStatement[] = [
        [
          "INSERT INTO office_native_worktrees VALUES(?,?,?,'draft',1)",
          [db.key, id, input.record.sid],
        ],
      ];
      for (const unit of input.units) {
        if (unit.worktreeID !== id || unit.source !== "trunk")
          throw new NativeStorageError("CONTENT", "Invalid initial Worktree membership");
        await assertTrunkUnit(db, unit);
        statements.push(draftInsert(db, unit, null));
      }
      await db.write(
        `create-worktree:${id}`,
        input,
        statements,
        "NOT EXISTS(SELECT 1 FROM office_native_worktrees WHERE scope=? AND id=?)",
        [db.key, id],
      );
      db.fence = {
        ...db.fence,
        draft: {
          worktreeID: id,
          generation: 1,
          status: "draft",
          head: input.units[0]?.draftHeadRevision ?? 0,
          removed: false,
        },
      };
      return { status: "created", aggregate: await currentAggregate(db, id) };
    },
    async addUnit(context, input) {
      const unit = readWorktreeUnit(input.unit);
      const id = unit.worktreeID;
      db.check(context.userID, unit.unitID);
      checkWorktree(db, id);
      const state = await aggregate(db, id);
      if (!state) return { status: "not-found" };
      if (state.worktree.status !== "draft") return { status: "status-mismatch", aggregate: state };
      if (state.units.length) return { status: "already-exists", aggregate: state };
      if (unit.source !== "trunk")
        throw new NativeStorageError("CONTENT", "addUnit requires a trunk Unit");
      await assertTrunkUnit(db, unit);
      await db.write(`add-unit:${id}`, { unit }, [draftInsert(db, unit, null)]);
      db.fence = { ...db.fence, draft: { ...requireDraftFence(db), head: unit.draftHeadRevision } };
      return { status: "added", aggregate: await currentAggregate(db, id) };
    },
    async createUnit(context, input) {
      db.check(context.userID, input.unit.unitID);
      return refs.createUnit(
        input.unit,
        await payloads.stageSnapshot(input.seed.snapshot, input.seed.sheetBlocks),
      );
    },
    async saveUnitMergeArtifact(context, input) {
      db.check(context.userID, input.unitID);
      const result = await refs.saveUnitMergeArtifact(
        input.worktreeID,
        input.artifact.readyDraftHeadRevision,
        await payloads.stageSnapshot(input.artifact.unit.snapshot, input.artifact.unit.sheetBlocks),
      );
      if (!("manifest" in result)) return result;
      const unit: WorktreeUnitSeed = await payloads.readSnapshot(result.manifest);
      return {
        status: result.status,
        artifact: { readyDraftHeadRevision: result.readyDraftHeadRevision, unit },
      };
    },
    async commitDraftChangeset(context, input) {
      const cs = input.changeset;
      db.check(context.userID, cs.unitID);
      try {
        const result = await refs.commitDraftChangeset(input.worktreeID, {
          unitID: cs.unitID,
          type: cs.type,
          baseRev: cs.baseRev,
          revision: cs.revision,
          sid: cs.sid,
          reqId: cs.reqId,
          value: await payloads.stageChangeset(cs),
        });
        if (result.status !== "committed") return result;
        return {
          status: "committed",
          headRevision: result.headRevision,
          changeset: await payloads.loadValue(result.value, "changeset"),
        };
      } catch (cause) {
        if (!(cause instanceof NativeStorageError) || cause.code !== "FENCE") throw cause;
        await assertAuthority(db);
        const state = await readWorktree(db, input.worktreeID);
        const unit = await readDraft(db, input.worktreeID);
        if (!state || !unit) return { status: "not-found" };
        if (state.status !== "draft")
          return { status: "not-editable", worktreeStatus: state.status };
        if (unit.removed || unit.merge_result) return { status: "unit-frozen" };
        if (unit.head === cs.baseRev) throw cause;
        return { status: "revision-mismatch", actualHeadRevision: unit.head };
      }
    },
    async dispose() {
      db.dispose();
    },
  };
}
