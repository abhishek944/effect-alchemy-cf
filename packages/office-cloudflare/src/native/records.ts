import { readValueJSON, readDraftJSON, readMergeResultJSON } from "./row-codecs.ts";
import type { UnitRecord } from "@univerjs-pro/collaboration-service";
import type {
  WorktreeAggregateRecord,
  WorktreeUnitRecord,
  WorktreeStatus,
} from "@univerjs-pro/collaboration-worktree-service";
import type { NativeDatabase } from "./database.ts";
import { NativeStorageError, nativeLimits, revision } from "./types.ts";
import type { NativePayloads } from "./payloads.ts";
import type { IChangeset } from "@univerjs/protocol";

export interface MainRow {
  type: UnitRecord["type"];
  head: number;
  creator: string;
  created: number;
  lifecycle: "active" | "soft" | "hard";
}
export interface WorktreeRow {
  id: string;
  sid: string;
  status: WorktreeStatus;
  generation: number;
}
export interface DraftRow {
  type: WorktreeUnitRecord["type"];
  source: "trunk" | "worktree";
  baseline: number | null;
  head: number;
  ready: number | null;
  creator: string;
  created: number;
  removed: number;
  merge_result: string | null;
  seed: string | null;
  artifact: string | null;
  artifact_ready: number | null;
}
export function readMain(db: NativeDatabase): Promise<MainRow | null> {
  return db.first("SELECT * FROM office_native_units WHERE scope=?", [db.key]);
}
export function unitRecord(db: NativeDatabase, row: MainRow): UnitRecord {
  return {
    unitID: db.scope.unitID,
    type: row.type,
    headRevision: row.head,
    creatorID: row.creator,
    createdAt: row.created,
  };
}
export function readWorktree(db: NativeDatabase, id: string): Promise<WorktreeRow | null> {
  db.checkReadWorktree(id);
  return db.first("SELECT * FROM office_native_worktrees WHERE scope=? AND id=?", [db.key, id]);
}
export function readDraft(db: NativeDatabase, id: string): Promise<DraftRow | null> {
  db.checkReadWorktree(id);
  return db.first("SELECT * FROM office_native_drafts WHERE scope=? AND worktree=?", [db.key, id]);
}
export function draftRecord(db: NativeDatabase, id: string, row: DraftRow): WorktreeUnitRecord {
  return {
    worktreeID: id,
    unitID: db.scope.unitID,
    type: row.type,
    source: row.source,
    ...(row.baseline === null ? {} : { baselineTrunkRevision: row.baseline }),
    draftHeadRevision: row.head,
    ...(row.ready === null ? {} : { readyDraftHeadRevision: row.ready }),
    creatorID: row.creator,
    createdAt: row.created,
    removed: Boolean(row.removed),
    ...(row.merge_result === null ? {} : { mergeResult: readMergeResultJSON(row.merge_result) }),
  };
}
export async function aggregate(
  db: NativeDatabase,
  id: string,
): Promise<WorktreeAggregateRecord | null> {
  db.checkReadWorktree(id);
  // One SELECT prevents reading status and frozen head from different commits.
  const row = await db.first<WorktreeRow & { unit_json: string | null }>(
    `SELECT w.*, CASE WHEN d.worktree IS NULL THEN NULL ELSE json_object(
      'type',d.type,'source',d.source,'baseline',d.baseline,'head',d.head,'ready',d.ready,
      'creator',d.creator,'created',d.created,'removed',d.removed,'merge_result',d.merge_result,
      'seed',d.seed,'artifact',d.artifact,'artifact_ready',d.artifact_ready) END unit_json
     FROM office_native_worktrees w LEFT JOIN office_native_drafts d ON d.scope=w.scope AND d.worktree=w.id
     WHERE w.scope=? AND w.id=?`,
    [db.key, id],
  );
  return row
    ? {
        worktree: { worktreeID: id, sid: row.sid, status: row.status },
        units: row.unit_json ? [draftRecord(db, id, readDraftJSON(row.unit_json))] : [],
      }
    : null;
}
export async function assertAuthority(db: NativeDatabase): Promise<void> {
  const row = await db.first(
    `SELECT 1 FROM office_native_authority WHERE scope=? AND epoch=? AND command_id=? AND step_id=?`,
    [db.key, db.fence.epoch, db.fence.commandID, db.fence.stepID],
  );
  if (!row)
    throw new NativeStorageError("FENCE", "Native invocation no longer owns the admitted step");
}
export async function history(
  db: NativeDatabase,
  payloads: NativePayloads,
  branch: string,
  head: number,
  range: { readonly from: number; readonly to?: number },
): Promise<readonly IChangeset[]> {
  const from = revision(range.from);
  const to = range.to === undefined ? head : revision(range.to);
  if (to > head) throw new NativeStorageError("CONTENT", "History range exceeds native head");
  const result: IChangeset[] = [];
  let cursor = from;
  while (cursor < to) {
    const rows = await db.all<{ revision: number; value: string }>(
      `SELECT revision,value FROM office_native_changes WHERE scope=? AND branch=? AND revision>? AND revision<=?
       ORDER BY revision LIMIT ?`,
      [db.key, branch, cursor, to, nativeLimits.historyPage],
    );
    if (!rows.length)
      throw new NativeStorageError("CONTENT", "Native history gap; absence is not noncommit proof");
    for (const row of rows) {
      if (row.revision !== cursor + 1)
        throw new NativeStorageError("CONTENT", "Non-contiguous native history");
      result.push(await payloads.loadValue(readValueJSON(row.value), "changeset"));
      cursor = row.revision;
    }
  }
  return result;
}
