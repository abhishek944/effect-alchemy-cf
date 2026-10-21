import { readWorktreeUnit } from "./record-shapes.ts";
import type { WorktreeUnitRecord } from "@univerjs-pro/collaboration-worktree-service";
import type { NativeDatabase } from "./database.ts";
import type { NativeStatement } from "./database.ts";
import { boundedID, metadata, NativeStorageError, revision } from "./types.ts";
import { aggregate, readMain } from "./records.ts";

export function checkWorktree(db: NativeDatabase, id: string, creating = false): void {
  boundedID(id);
  db.check();
  if ((!db.fence.draft && !creating) || (db.fence.draft && db.fence.draft.worktreeID !== id)) {
    throw new NativeStorageError("FENCE", "Invocation must bind the exact native Worktree vector");
  }
}
export function requireDraftFence(db: NativeDatabase) {
  const fence = db.fence.draft;
  if (!fence) throw new NativeStorageError("FENCE", "Native Worktree vector required");
  return fence;
}
export async function assertTrunkUnit(db: NativeDatabase, unit: WorktreeUnitRecord): Promise<void> {
  const main = await readMain(db);
  if (
    !main ||
    main.lifecycle !== "active" ||
    main.type !== unit.type ||
    main.head !== unit.baselineTrunkRevision
  )
    throw new NativeStorageError(
      "CONTENT",
      "Worktree baseline must match the active native trunk Unit",
    );
}
export function draftInsert(
  db: NativeDatabase,
  input: WorktreeUnitRecord,
  seed: string | null,
): NativeStatement {
  const unit = readWorktreeUnit(input);
  db.check(undefined, unit.unitID);
  boundedID(unit.worktreeID);
  metadata(unit);
  revision(unit.draftHeadRevision);
  if (
    ![1, 2, 3].includes(unit.type) ||
    unit.removed ||
    unit.mergeResult ||
    unit.readyDraftHeadRevision !== undefined ||
    (unit.source === "trunk"
      ? unit.baselineTrunkRevision !== unit.draftHeadRevision
      : unit.draftHeadRevision !== 1 || unit.baselineTrunkRevision !== undefined)
  ) {
    throw new NativeStorageError("CONTENT", "Invalid initial Worktree Unit record");
  }
  return [
    `INSERT INTO office_native_drafts(scope,worktree,type,source,baseline,head,creator,created,seed)
    VALUES(?,?,?,?,?,?,?,?,?)`,
    [
      db.key,
      unit.worktreeID,
      unit.type,
      unit.source,
      unit.baselineTrunkRevision ?? null,
      unit.draftHeadRevision,
      unit.creatorID,
      unit.createdAt,
      seed,
    ],
  ];
}
export async function currentAggregate(db: NativeDatabase, id: string) {
  const value = await aggregate(db, id);
  if (!value) throw new NativeStorageError("CONTENT", "Native Worktree disappeared");
  return value;
}
