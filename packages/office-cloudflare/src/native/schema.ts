import type { D1Database } from "@cloudflare/workers-types";
import { NativeStorageError } from "./types.ts";

export const nativeSchemaVersion = 2;
export const nativeSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS office_native_schema (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL)`,
  `INSERT OR IGNORE INTO office_native_schema VALUES(1,2)`,
  `CREATE TABLE IF NOT EXISTS office_native_guard (
    token TEXT PRIMARY KEY, ok INTEGER NOT NULL CONSTRAINT office_native_fence CHECK(ok=1))`,
  `CREATE TABLE IF NOT EXISTS office_native_authority (
    scope TEXT PRIMARY KEY, epoch INTEGER NOT NULL, command_id TEXT, step_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS office_native_units (
    scope TEXT PRIMARY KEY, type INTEGER NOT NULL, head INTEGER NOT NULL,
    creator TEXT NOT NULL, created INTEGER NOT NULL,
    lifecycle TEXT NOT NULL CHECK(lifecycle IN ('active','soft','hard')))`,
  `CREATE TABLE IF NOT EXISTS office_native_snapshots (
    scope TEXT NOT NULL, revision INTEGER NOT NULL, manifest TEXT NOT NULL,
    PRIMARY KEY(scope,revision))`,
  `CREATE TABLE IF NOT EXISTS office_native_pieces (
    scope TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, bytes INTEGER NOT NULL,
    PRIMARY KEY(scope,key))`,
  `CREATE TABLE IF NOT EXISTS office_native_values (
    scope TEXT NOT NULL, value_hash TEXT NOT NULL, kind TEXT NOT NULL, header TEXT NOT NULL,
    PRIMARY KEY(scope,value_hash))`,
  `CREATE TABLE IF NOT EXISTS office_native_blocks (
    scope TEXT NOT NULL, manifest TEXT NOT NULL, block_id TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY(scope,manifest,block_id))`,
  `CREATE INDEX IF NOT EXISTS office_native_block_lookup ON office_native_blocks(scope,block_id)`,
  `CREATE INDEX IF NOT EXISTS office_native_snapshot_manifest ON office_native_snapshots(scope,manifest)`,
  `CREATE TABLE IF NOT EXISTS office_native_changes (
    scope TEXT NOT NULL, branch TEXT NOT NULL, revision INTEGER NOT NULL,
    sid TEXT, req_id INTEGER, value TEXT NOT NULL,
    PRIMARY KEY(scope,branch,revision), UNIQUE(scope,branch,sid,req_id))`,
  `CREATE TABLE IF NOT EXISTS office_native_worktrees (
    scope TEXT NOT NULL, id TEXT NOT NULL, sid TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft','ready','merging','merged','discarded')),
    generation INTEGER NOT NULL, PRIMARY KEY(scope,id))`,
  `CREATE TABLE IF NOT EXISTS office_native_drafts (
    scope TEXT NOT NULL, worktree TEXT NOT NULL, type INTEGER NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('trunk','worktree')), baseline INTEGER,
    head INTEGER NOT NULL, ready INTEGER, creator TEXT NOT NULL, created INTEGER NOT NULL,
    removed INTEGER NOT NULL DEFAULT 0, merge_result TEXT, seed TEXT, artifact TEXT,
    artifact_ready INTEGER, PRIMARY KEY(scope,worktree))`,
  `CREATE TABLE IF NOT EXISTS office_native_receipts (
    scope TEXT NOT NULL, command_id TEXT NOT NULL, step_id TEXT NOT NULL, action TEXT NOT NULL,
    fingerprint TEXT NOT NULL, epoch INTEGER NOT NULL, PRIMARY KEY(scope,command_id,step_id,action))`,
  `CREATE TABLE IF NOT EXISTS office_native_prepared_slots (
    scope TEXT NOT NULL, command_id TEXT NOT NULL, step_id TEXT NOT NULL, action TEXT NOT NULL,
    write_id TEXT NOT NULL, payload_digest TEXT NOT NULL, fingerprint TEXT NOT NULL,
    epoch INTEGER NOT NULL CHECK(epoch>0), enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    PRIMARY KEY(scope,command_id,step_id,action), UNIQUE(scope,write_id))`,
  `CREATE TABLE IF NOT EXISTS office_native_outbox (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL,
    command_id TEXT NOT NULL, step_id TEXT NOT NULL, action TEXT NOT NULL,
    epoch INTEGER NOT NULL, UNIQUE(scope,command_id,step_id,action))`,
  `CREATE INDEX IF NOT EXISTS office_native_outbox_scope ON office_native_outbox(scope,sequence)`,
] as const;

export async function initializeNativeSchema(database: D1Database): Promise<void> {
  // Read a pre-existing version before additive DDL; never reset an incompatible database.
  const table = await database
    .withSession("first-primary")
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='office_native_schema'")
    .first();
  if (table) await verifyVersion(database);
  await database.batch(nativeSchemaStatements.map((sql) => database.prepare(sql)));
  await verifyVersion(database);
}
async function verifyVersion(database: D1Database): Promise<void> {
  const row = await database
    .withSession("first-primary")
    .prepare("SELECT version FROM office_native_schema WHERE singleton=1")
    .first<{ version: number }>();
  if (row?.version !== nativeSchemaVersion) {
    throw new NativeStorageError(
      "VERSION",
      "Incompatible Office native schema; migration required",
    );
  }
}
