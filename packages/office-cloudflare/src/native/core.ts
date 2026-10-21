import { visibleMain } from "./read-visibility.ts";
import { readPieceJSON, readValueJSON } from "./row-codecs.ts";
import type { IDatabaseAdapter } from "@univerjs-pro/collaboration-service";
import type { NativeDatabase } from "./database.ts";
import type { NativePayloads } from "./payloads.ts";
import type { NativeCoreReferences } from "./core-refs.ts";
import { assertAuthority, history, readMain, unitRecord } from "./records.ts";
import { NativeStorageError, boundedID, revision as nativeRevision } from "./types.ts";

export function createNativeDatabaseAdapter(
  db: NativeDatabase,
  payloads: NativePayloads,
  refs: NativeCoreReferences,
): IDatabaseAdapter {
  const snapshotRef = async (unitID: string, revision?: number) => {
    db.check(undefined, unitID);
    const main = await visibleMain(db);
    if (!main) return null;
    const target = revision === undefined || revision === 0 ? main.head : nativeRevision(revision);
    if (target > main.head)
      throw new NativeStorageError("SCOPE", "Snapshot exceeds granted branch head");
    return db.first<{ revision: number; manifest: string }>(
      "SELECT revision,manifest FROM office_native_snapshots WHERE scope=? AND revision<=? ORDER BY revision DESC LIMIT 1",
      [db.key, target],
    );
  };
  return {
    async getUnit(context, unitID) {
      db.check(context.userID, unitID);
      const row = await visibleMain(db);
      return row ? unitRecord(db, row) : null;
    },
    async getSnapshotInfo(context, unitID, options) {
      db.check(context.userID, unitID);
      const row = await snapshotRef(unitID, options?.revision);
      if (!row) return null;
      const manifest = await payloads.readManifest(readPieceJSON(row.manifest));
      return (await visibleMain(db)) ? { unitID, type: manifest.type, rev: row.revision } : null;
    },
    async getSnapshot(context, unitID, options) {
      db.check(context.userID, unitID);
      const row = await snapshotRef(unitID, options?.revision);
      if (!row) return null;
      const manifest = await payloads.readManifest(readPieceJSON(row.manifest));
      const value = await payloads.loadValue(manifest.snapshot, "snapshot");
      return (await visibleMain(db)) ? value : null;
    },
    async getSheetBlock(context, unitID, blockID) {
      db.check(context.userID, unitID);
      boundedID(blockID);
      const main = await visibleMain(db);
      if (!main) return null;
      const row = await db.first<{ value: string }>(
        `SELECT b.value FROM office_native_blocks b JOIN office_native_units u ON u.scope=b.scope
         JOIN office_native_snapshots s ON s.scope=b.scope AND s.manifest=b.manifest
         WHERE b.scope=? AND b.block_id=? AND u.lifecycle='active' AND s.revision<=? LIMIT 1`,
        [db.key, blockID, main.head],
      );
      if (!row) return null;
      const value = await payloads.loadValue(readValueJSON(row.value), "block");
      return (await visibleMain(db)) ? value : null;
    },
    async getChangesets(context, unitID, range) {
      db.check(context.userID, unitID);
      const row = await visibleMain(db);
      if (!row) return null;
      const values = await history(db, payloads, "", row.head, range);
      return (await visibleMain(db)) ? values : null;
    },
    async createUnit(context, input) {
      db.check(context.userID, input.record.unitID);
      try {
        return await refs.createUnit(
          input.record,
          await payloads.stageSnapshot(input.snapshot, input.sheetBlocks),
        );
      } catch (cause) {
        if (!(cause instanceof NativeStorageError) || cause.code !== "FENCE") throw cause;
        await assertAuthority(db);
        const existing = await readMain(db);
        if (!existing || existing.lifecycle === "hard") throw cause;
        return { status: "already-exists", record: unitRecord(db, existing) };
      }
    },
    async saveSnapshot(context, input) {
      db.check(context.userID, input.snapshot.unitID);
      await refs.saveSnapshot(await payloads.stageSnapshot(input.snapshot, input.sheetBlocks));
    },
    async commitChangeset(context, input) {
      const cs = input.changeset;
      db.check(context.userID, cs.unitID);
      try {
        const result = await refs.commitChangeset({
          unitID: cs.unitID,
          type: cs.type,
          baseRev: cs.baseRev,
          revision: cs.revision,
          sid: cs.sid,
          reqId: cs.reqId,
          value: await payloads.stageChangeset(cs),
        });
        if (result.status === "revision-mismatch") return result;
        return {
          status: "committed",
          headRevision: result.headRevision,
          changeset: await payloads.loadValue(result.value, "changeset"),
        };
      } catch (cause) {
        if (!(cause instanceof NativeStorageError) || cause.code !== "FENCE") throw cause;
        await assertAuthority(db);
        const current = await readMain(db);
        if (!current || current.lifecycle !== "active" || current.head === cs.baseRev) throw cause;
        return { status: "revision-mismatch", actualHeadRevision: current.head };
      }
    },
    async deleteUnits(context, input) {
      db.check(context.userID);
      if (input.unitIDs.length > 1)
        throw new NativeStorageError("SCOPE", "One native document per adapter scope");
      for (const id of input.unitIDs) db.check(context.userID, id);
      if (!input.unitIDs.length) return { units: [] };
      const row = await readMain(db);
      if (!row) throw new NativeStorageError("CONTENT", "Native Unit not found");
      const target = input.hardDelete ? "hard" : "soft";
      if (row.lifecycle === "hard" || row.lifecycle === target)
        return {
          units: [
            {
              unitID: db.scope.unitID,
              status: row.lifecycle === "hard" ? "already-hard-deleted" : "already-soft-deleted",
            },
          ],
        };
      await db.write(`delete:${target}`, { target }, [
        ["UPDATE office_native_units SET lifecycle=? WHERE scope=?", [target, db.key]],
      ]);
      db.fence = { ...db.fence, main: { head: row.head, lifecycle: target } };
      return {
        units: [
          { unitID: db.scope.unitID, status: input.hardDelete ? "hard-deleted" : "soft-deleted" },
        ],
      };
    },
    async recoverUnits(context, input) {
      db.check(context.userID);
      if (input.unitIDs.length > 1)
        throw new NativeStorageError("SCOPE", "One native document per adapter scope");
      for (const id of input.unitIDs) db.check(context.userID, id);
      if (!input.unitIDs.length) return { units: [] };
      const row = await readMain(db);
      if (!row || row.lifecycle === "hard")
        throw new NativeStorageError("CONTENT", "Native Unit is absent or permanently deleted");
      if (row.lifecycle === "active")
        return { units: [{ unitID: db.scope.unitID, status: "already-active" }] };
      await db.write("recover-main", { head: row.head }, [
        ["UPDATE office_native_units SET lifecycle='active' WHERE scope=?", [db.key]],
      ]);
      db.fence = { ...db.fence, main: { head: row.head, lifecycle: "active" } };
      return { units: [{ unitID: db.scope.unitID, status: "recovered" }] };
    },
    async dispose() {
      db.dispose();
    },
  };
}
