import { assertChangesetHeader } from "./value-proofs.ts";
import { readUnitRecord } from "./record-shapes.ts";
import { readChangesetRef, readSnapshotRefs } from "./ref-shapes.ts";
import { readValueJSON } from "./row-codecs.ts";
import type { UnitRecord, CreateUnitDatabaseResult } from "@univerjs-pro/collaboration-service";
import type { NativeDatabase } from "./database.ts";
import type { NativeStatement } from "./database.ts";
import type { NativePayloads } from "./payloads.ts";
import { metadata, NativeStorageError, revision } from "./types.ts";
import type { NativeSnapshotRefs, NativeChangesetRef, NativeValueRef } from "./types.ts";
import { assertAuthority, readMain, unitRecord } from "./records.ts";

export type NativeCommitRefResult =
  | { readonly status: "committed"; readonly headRevision: number; readonly value: NativeValueRef }
  | { readonly status: "revision-mismatch"; readonly actualHeadRevision: number };

export class NativeCoreReferences {
  private readonly db: NativeDatabase;
  private readonly payloads: NativePayloads;
  constructor(db: NativeDatabase, payloads: NativePayloads) {
    this.db = db;
    this.payloads = payloads;
  }
  private async snapshotStatements(input: NativeSnapshotRefs) {
    const refs = readSnapshotRefs(input);
    const manifest = await this.payloads.publishManifest(refs);
    const key = metadata(manifest);
    // Unpublished index pages are unreachable until the bounded final snapshot/head batch.
    for (let offset = 0; offset < refs.blocks.length; offset += 32) {
      const page = refs.blocks
        .slice(offset, offset + 32)
        .map((block) => ({ blockID: block.blockID, value: metadata(block.value) }));
      await this.db.write(
        "stage-block-index",
        { manifest, offset },
        [
          [
            `INSERT OR IGNORE INTO office_native_blocks(scope,manifest,block_id,value)
         SELECT ?,?,json_extract(value,'$.blockID'),json_extract(value,'$.value') FROM json_each(?)`,
            [this.db.key, key, metadata(page, 64 * 1024)],
          ],
        ],
        "1",
        [],
        false,
      );
    }
    const token = crypto.randomUUID();
    const statements: NativeStatement[] = [
      [
        `INSERT INTO office_native_guard VALUES(?,CASE WHEN
        (SELECT count(*) FROM office_native_blocks WHERE scope=? AND manifest=?)=?
        AND NOT EXISTS(SELECT 1 FROM office_native_blocks staged JOIN office_native_blocks old
          ON old.scope=staged.scope AND old.block_id=staged.block_id AND old.value<>staged.value
          JOIN office_native_snapshots published ON published.scope=old.scope AND published.manifest=old.manifest
          WHERE staged.scope=? AND staged.manifest=?) THEN 1 ELSE 0 END)`,
        [token, this.db.key, key, refs.blocks.length, this.db.key, key],
      ],
      [
        "INSERT INTO office_native_snapshots(scope,revision,manifest) VALUES(?,?,?)",
        [this.db.key, refs.revision, key],
      ],
      ["DELETE FROM office_native_guard WHERE token=?", [token]],
    ];
    return { manifest, statements };
  }
  async createUnit(
    inputRecord: UnitRecord,
    inputRefs: NativeSnapshotRefs,
  ): Promise<CreateUnitDatabaseResult> {
    const record = readUnitRecord(inputRecord);
    const refs = readSnapshotRefs(inputRefs);
    this.db.check(undefined, record.unitID);
    if (record.headRevision !== 1 || refs.revision !== 1 || record.type !== refs.type) {
      throw new NativeStorageError(
        "CONTENT",
        "Initial native snapshot must match revision 1 record",
      );
    }
    const existing = await readMain(this.db);
    if (existing) {
      if (existing.lifecycle === "hard")
        throw new NativeStorageError("CONTENT", "Hard-deleted Unit identity cannot be reused");
      return { status: "already-exists", record: unitRecord(this.db, existing) };
    }
    const staged = await this.snapshotStatements(refs);
    await this.db.write(
      "create-main",
      [record, staged.manifest],
      [
        [
          "INSERT INTO office_native_units VALUES(?,?,?,?,?,'active')",
          [this.db.key, record.type, 1, record.creatorID, record.createdAt],
        ],
        ...staged.statements,
      ],
      "1",
      [],
      refs.snapshot,
    );
    this.db.fence = { ...this.db.fence, main: { head: 1, lifecycle: "active" } };
    return { status: "created", record };
  }
  async saveSnapshot(input: NativeSnapshotRefs): Promise<void> {
    const refs = readSnapshotRefs(input);
    const row = await readMain(this.db);
    if (!row || row.lifecycle !== "active" || refs.type !== row.type || refs.revision > row.head) {
      throw new NativeStorageError(
        "CONTENT",
        "Snapshot is not an active confirmed native revision",
      );
    }
    revision(refs.revision);
    const existing = await this.db.first<{ manifest: string }>(
      "SELECT manifest FROM office_native_snapshots WHERE scope=? AND revision=?",
      [this.db.key, refs.revision],
    );
    const manifest = await this.payloads.publishManifest(refs);
    if (existing) {
      if (existing.manifest !== metadata(manifest))
        throw new NativeStorageError(
          "CONFLICT",
          "Snapshot revision already contains different bytes",
        );
      return;
    }
    const staged = await this.snapshotStatements(refs);
    await this.db.write(
      `snapshot:${refs.revision}`,
      staged.manifest,
      staged.statements,
      "EXISTS(SELECT 1 FROM office_native_units WHERE scope=? AND head>=? AND lifecycle='active')",
      [this.db.key, refs.revision],
      refs.snapshot,
    );
  }
  async commitChangeset(input: NativeChangesetRef): Promise<NativeCommitRefResult> {
    const ref = readChangesetRef(input);
    this.db.check(undefined, ref.unitID);
    revision(ref.revision);
    revision(ref.baseRev);
    if (ref.revision !== ref.baseRev + 1)
      throw new NativeStorageError("CONTENT", "Native revision is not base + 1");
    await this.payloads.verifyValue(ref.value, "changeset");
    await assertChangesetHeader(this.db, ref);
    const row = await readMain(this.db);
    if (!row || row.lifecycle !== "active" || ref.type !== row.type)
      throw new NativeStorageError("CONTENT", "Native Unit is not active");
    const duplicate =
      ref.sid === undefined || ref.reqId === undefined
        ? null
        : await this.db.first<{ revision: number; value: string }>(
            "SELECT revision,value FROM office_native_changes WHERE scope=? AND branch='' AND sid=? AND req_id=?",
            [this.db.key, ref.sid, ref.reqId],
          );
    if (duplicate) {
      if (duplicate.value !== metadata(ref.value))
        throw new NativeStorageError(
          "CONFLICT",
          "Native submission identity reused with different bytes",
        );
      return {
        status: "committed",
        headRevision: duplicate.revision,
        value: readValueJSON(duplicate.value),
      };
    }
    if (row.head !== ref.baseRev)
      return { status: "revision-mismatch", actualHeadRevision: row.head };
    try {
      await this.db.write(
        `main-change:${ref.revision}`,
        ref,
        [
          [
            "UPDATE office_native_units SET head=? WHERE scope=? AND head=? AND lifecycle='active'",
            [ref.revision, this.db.key, ref.baseRev],
          ],
          [
            "INSERT INTO office_native_changes VALUES(?,'',?,?,?,?)",
            [this.db.key, ref.revision, ref.sid ?? null, ref.reqId ?? null, metadata(ref.value)],
          ],
        ],
        "EXISTS(SELECT 1 FROM office_native_units WHERE scope=? AND head=? AND lifecycle='active')",
        [this.db.key, ref.baseRev],
        ref.value,
      );
    } catch (cause) {
      if (!(cause instanceof NativeStorageError) || cause.code !== "FENCE") throw cause;
      await assertAuthority(this.db);
      const current = await readMain(this.db);
      if (!current || current.lifecycle !== "active" || current.head === ref.baseRev) throw cause;
      return { status: "revision-mismatch", actualHeadRevision: current.head };
    }
    this.db.fence = { ...this.db.fence, main: { head: ref.revision, lifecycle: "active" } };
    return { status: "committed", headRevision: ref.revision, value: ref.value };
  }
}
