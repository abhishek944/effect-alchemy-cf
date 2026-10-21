import { visibleMain } from "./read-visibility.ts";
import { readStepReceipts } from "./step-receipts.ts";
import { readPieceJSON, readValueJSON } from "./row-codecs.ts";
import type { NativeDatabase } from "./database.ts";
import type { NativePayloads } from "./payloads.ts";
import { readDraft, readWorktree } from "./records.ts";
import { boundedID, nativeLimits, NativeStorageError, revision } from "./types.ts";

/** Native metadata only; bytes are resolved/decoded in the trusted Node broker, not in workerd. */
export class NativeReferenceReads {
  private readonly db: NativeDatabase;
  private readonly payloads: NativePayloads;
  constructor(db: NativeDatabase, payloads: NativePayloads) {
    this.db = db;
    this.payloads = payloads;
  }
  async snapshot(atRevision?: number) {
    const main = await visibleMain(this.db);
    if (!main) return null;
    const ceiling = main.head;
    const target = atRevision === undefined || atRevision === 0 ? ceiling : revision(atRevision);
    if (target > ceiling)
      throw new NativeStorageError("SCOPE", "Snapshot exceeds the granted branch baseline");
    const row = await this.db.first<{ manifest: string }>(
      "SELECT manifest FROM office_native_snapshots WHERE scope=? AND revision<=? ORDER BY revision DESC LIMIT 1",
      [this.db.key, target],
    );
    return row ? this.payloads.readManifest(readPieceJSON(row.manifest)) : null;
  }
  async seed(worktreeID: string) {
    boundedID(worktreeID);
    if (!(await this.contentVisible(worktreeID))) return null;
    const row = await readDraft(this.db, worktreeID);
    return row?.seed ? this.payloads.readManifest(readPieceJSON(row.seed)) : null;
  }
  async mergeArtifact(worktreeID: string) {
    boundedID(worktreeID);
    if (!(await this.contentVisible(worktreeID))) return null;
    const row = await readDraft(this.db, worktreeID);
    return row?.artifact
      ? {
          readyDraftHeadRevision: row.artifact_ready,
          manifest: await this.payloads.readManifest(readPieceJSON(row.artifact)),
        }
      : null;
  }
  async changesets(
    branch: string,
    afterRevision: number,
    limit: number = nativeLimits.historyPage,
  ) {
    if (branch) {
      boundedID(branch);
      this.db.checkReadWorktree(branch);
    }
    const head = await this.visibleHead(branch);
    if (head === null) return [];
    revision(afterRevision);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > nativeLimits.historyPage)
      throw new NativeStorageError("LIMIT", "Invalid native history page");
    const rows = await this.db.all<{
      revision: number;
      sid: string | null;
      req_id: number | null;
      value: string;
    }>(
      "SELECT revision,sid,req_id,value FROM office_native_changes WHERE scope=? AND branch=? AND revision>? AND revision<=? ORDER BY revision LIMIT ?",
      [this.db.key, branch, afterRevision, head, limit],
    );
    return rows.map((row) => ({
      revision: row.revision,
      sid: row.sid,
      reqId: row.req_id,
      value: readValueJSON(row.value),
    }));
  }
  async submission(branch: string, sid: string, reqId: number) {
    if (branch) {
      boundedID(branch);
      this.db.checkReadWorktree(branch);
    }
    const head = await this.visibleHead(branch);
    if (head === null) return null;
    boundedID(sid);
    revision(reqId);
    return this.db.first<{ revision: number; value: string }>(
      "SELECT revision,value FROM office_native_changes WHERE scope=? AND branch=? AND sid=? AND req_id=? AND revision<=?",
      [this.db.key, branch, sid, reqId, head],
    );
  }
  private async visibleHead(branch: string): Promise<number | null> {
    if (!(await this.contentVisible(branch))) return null;
    if (branch) {
      this.db.checkReadWorktree(branch);
      const row = await readDraft(this.db, branch);
      return row?.head ?? null;
    }
    return (await visibleMain(this.db))?.head ?? null;
  }
  private async contentVisible(branch: string): Promise<boolean> {
    if (!this.db.readGrant) return true;
    const target = branch || this.db.readGrant.draft?.worktreeID;
    if (!target) return true;
    const worktree = await readWorktree(this.db, target);
    return worktree !== null && worktree.status !== "discarded";
  }
  stepReceipts(commandID: string, stepID: string, cursor: string | null = null, limit = 100) {
    return readStepReceipts(this.db, commandID, stepID, cursor, limit);
  }
  async receipt(commandID: string, stepID: string, action: string) {
    boundedID(commandID);
    boundedID(stepID);
    return this.db.first<{ fingerprint: string; epoch: number }>(
      "SELECT fingerprint,epoch FROM office_native_receipts WHERE scope=? AND command_id=? AND step_id=? AND action=?",
      [this.db.key, commandID, stepID, action],
    );
  }
  async outbox(afterSequence: number, limit: number = nativeLimits.historyPage) {
    revision(afterSequence);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > nativeLimits.historyPage)
      throw new NativeStorageError("LIMIT", "Invalid native outbox page");
    return this.db.all<{
      sequence: number;
      command_id: string;
      step_id: string;
      action: string;
      epoch: number;
    }>(
      "SELECT sequence,command_id,step_id,action,epoch FROM office_native_outbox WHERE scope=? AND sequence>? ORDER BY sequence LIMIT ?",
      [this.db.key, afterSequence, limit],
    );
  }
}
