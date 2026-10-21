import type { NativeDatabase } from "./database.ts";
import { readMain, readDraft, readWorktree } from "./records.ts";
import type { MainRow, DraftRow } from "./records.ts";
export async function visibleDraft(db: NativeDatabase, id: string): Promise<DraftRow | null> {
  if (db.readGrant && (await readWorktree(db, id))?.status === "discarded") return null;
  return readDraft(db, id);
}
/** Draft read grants may read their trunk BASELINE, never the subsequently advanced main head. */
export async function visibleMain(db: NativeDatabase): Promise<MainRow | null> {
  const main = await readMain(db);
  if (!main || main.lifecycle !== "active") return null;
  const target = db.readGrant?.draft;
  if (!target) return main;
  const draft = await visibleDraft(db, target.worktreeID);
  if (!draft || draft.source !== "trunk" || draft.baseline === null) return null;
  return { ...main, head: Math.min(main.head, draft.baseline) };
}
