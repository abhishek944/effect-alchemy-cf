import { assertChangesetHeader } from "./value-proofs.ts";
import { readWorktreeUnit } from "./record-shapes.ts";
import { readChangesetRef, readSnapshotRefs } from "./ref-shapes.ts";
import { readPieceJSON, readValueJSON } from "./row-codecs.ts";
import type {
  WorktreeUnitRecord,
  CreateWorktreeUnitDatabaseResult,
  SaveWorktreeUnitMergeArtifactResult,
  CommitWorktreeChangesetResult,
} from "@univerjs-pro/collaboration-worktree-service";
import type {
  NativeChangesetRef,
  NativeSnapshotRefs,
  NativePieceRef,
  NativeValueRef,
} from "./types.ts";
import { metadata, NativeStorageError, revision } from "./types.ts";
import type { NativeDatabase } from "./database.ts";
import type { NativePayloads } from "./payloads.ts";
import { aggregate, assertAuthority, readDraft, readWorktree } from "./records.ts";
import {
  requireDraftFence,
  checkWorktree,
  currentAggregate,
  draftInsert,
} from "./worktree-state.ts";

export type NativeDraftCommitRefResult =
  | Exclude<CommitWorktreeChangesetResult, { status: "committed" }>
  | { readonly status: "committed"; readonly headRevision: number; readonly value: NativeValueRef };
export type NativeMergeArtifactRefResult =
  | Exclude<SaveWorktreeUnitMergeArtifactResult, { status: "saved" | "already-saved" }>
  | {
      readonly status: "saved" | "already-saved";
      readonly readyDraftHeadRevision: number;
      readonly manifest: NativePieceRef;
    };
export class NativeWorktreeReferences {
  private readonly db: NativeDatabase;
  private readonly payloads: NativePayloads;
  constructor(db: NativeDatabase, payloads: NativePayloads) {
    this.db = db;
    this.payloads = payloads;
  }
  async createUnit(
    inputUnit: WorktreeUnitRecord,
    inputRefs: NativeSnapshotRefs,
  ): Promise<CreateWorktreeUnitDatabaseResult> {
    const unit = readWorktreeUnit(inputUnit);
    const refs = readSnapshotRefs(inputRefs);
    const id = unit.worktreeID;
    checkWorktree(this.db, id);
    this.db.check(undefined, unit.unitID);
    const state = await aggregate(this.db, id);
    if (!state) return { status: "not-found" };
    if (state.worktree.status !== "draft") return { status: "status-mismatch", aggregate: state };
    const existing = state.units[0];
    if (existing)
      return {
        status: existing.source === "worktree" ? "already-created" : "unit-exists",
        aggregate: state,
      };
    if (unit.source !== "worktree" || refs.revision !== 1 || refs.type !== unit.type) {
      throw new NativeStorageError("CONTENT", "Invalid Worktree seed identity");
    }
    const manifest = await this.payloads.publishManifest(refs);
    await this.db.write(
      `create-draft:${id}`,
      [unit, manifest],
      [draftInsert(this.db, unit, metadata(manifest))],
      "EXISTS(SELECT 1 FROM office_native_worktrees WHERE scope=? AND id=? AND status='draft')",
      [this.db.key, id],
      refs.snapshot,
    );
    this.db.fence = { ...this.db.fence, draft: { ...requireDraftFence(this.db), head: 1 } };
    return { status: "created", aggregate: await currentAggregate(this.db, id) };
  }
  async saveUnitMergeArtifact(
    id: string,
    ready: number,
    inputRefs: NativeSnapshotRefs,
  ): Promise<NativeMergeArtifactRefResult> {
    const refs = readSnapshotRefs(inputRefs);
    checkWorktree(this.db, id);
    revision(ready);
    const worktree = await readWorktree(this.db, id);
    const unit = await readDraft(this.db, id);
    if (!worktree || !unit) return { status: "not-found" };
    if (refs.type !== unit.type)
      throw new NativeStorageError("CONTENT", "Merge artifact changed native Unit type");
    if (worktree.status !== "merging" || unit.ready !== ready) return { status: "stale-merge" };
    if (unit.artifact && unit.artifact_ready === ready)
      return {
        status: "already-saved",
        readyDraftHeadRevision: ready,
        manifest: readPieceJSON(unit.artifact),
      };
    const manifest = await this.payloads.publishManifest(refs);
    await this.db.write(
      `artifact:${id}:${ready}`,
      { ready, manifest },
      [
        [
          "UPDATE office_native_drafts SET artifact=?,artifact_ready=? WHERE scope=? AND worktree=?",
          [metadata(manifest), ready, this.db.key, id],
        ],
      ],
      "EXISTS(SELECT 1 FROM office_native_drafts WHERE scope=? AND worktree=? AND ready=? AND artifact IS NULL)",
      [this.db.key, id, ready],
      refs.snapshot,
    );
    return { status: "saved", readyDraftHeadRevision: ready, manifest };
  }
  async commitDraftChangeset(
    id: string,
    input: NativeChangesetRef,
  ): Promise<NativeDraftCommitRefResult> {
    const ref = readChangesetRef(input);
    checkWorktree(this.db, id);
    this.db.check(undefined, ref.unitID);
    revision(ref.revision);
    revision(ref.baseRev);
    if (ref.revision !== ref.baseRev + 1)
      throw new NativeStorageError("CONTENT", "Draft revision is not base + 1");
    const worktree = await readWorktree(this.db, id);
    const unit = await readDraft(this.db, id);
    if (!worktree || !unit) return { status: "not-found" };
    if (worktree.status !== "draft")
      return { status: "not-editable", worktreeStatus: worktree.status };
    if (unit.removed || unit.merge_result) return { status: "unit-frozen" };
    if (ref.type !== unit.type)
      throw new NativeStorageError("CONTENT", "Native draft type changed");
    await this.payloads.verifyValue(ref.value, "changeset");
    await assertChangesetHeader(this.db, ref);
    const duplicate =
      ref.sid === undefined || ref.reqId === undefined
        ? null
        : await this.db.first<{ revision: number; value: string }>(
            "SELECT revision,value FROM office_native_changes WHERE scope=? AND branch=? AND sid=? AND req_id=?",
            [this.db.key, id, ref.sid, ref.reqId],
          );
    if (duplicate) {
      if (duplicate.value !== metadata(ref.value))
        throw new NativeStorageError(
          "CONFLICT",
          "Draft submission identity reused with different bytes",
        );
      return {
        status: "committed",
        headRevision: duplicate.revision,
        value: readValueJSON(duplicate.value),
      };
    }
    if (unit.head !== ref.baseRev)
      return { status: "revision-mismatch", actualHeadRevision: unit.head };
    try {
      await this.db.write(
        `draft-change:${id}:${ref.revision}`,
        ref,
        [
          [
            "UPDATE office_native_drafts SET head=? WHERE scope=? AND worktree=? AND head=?",
            [ref.revision, this.db.key, id, ref.baseRev],
          ],
          [
            "INSERT INTO office_native_changes VALUES(?,?,?,?,?,?)",
            [
              this.db.key,
              id,
              ref.revision,
              ref.sid ?? null,
              ref.reqId ?? null,
              metadata(ref.value),
            ],
          ],
        ],
        `EXISTS(SELECT 1 FROM office_native_drafts d JOIN office_native_worktrees w ON w.scope=d.scope AND w.id=d.worktree
          WHERE d.scope=? AND d.worktree=? AND d.head=? AND d.removed=0 AND d.merge_result IS NULL AND w.status='draft')`,
        [this.db.key, id, ref.baseRev],
        ref.value,
      );
    } catch (cause) {
      if (!(cause instanceof NativeStorageError) || cause.code !== "FENCE") throw cause;
      await assertAuthority(this.db);
      const state = await readWorktree(this.db, id);
      const current = await readDraft(this.db, id);
      if (!state || !current) return { status: "not-found" };
      if (state.status !== "draft") return { status: "not-editable", worktreeStatus: state.status };
      if (current.removed || current.merge_result) return { status: "unit-frozen" };
      if (current.head === ref.baseRev) throw cause;
      return { status: "revision-mismatch", actualHeadRevision: current.head };
    }
    this.db.fence = {
      ...this.db.fence,
      draft: { ...requireDraftFence(this.db), head: ref.revision },
    };
    return { status: "committed", headRevision: ref.revision, value: ref.value };
  }
}
