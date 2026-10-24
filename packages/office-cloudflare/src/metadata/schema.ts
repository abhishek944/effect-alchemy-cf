import type { D1Database } from "@cloudflare/workers-types";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import { sessionSchemaStatements } from "./sessions/schemas.ts";
import { jobSchemaStatements } from "./jobs/schemas.ts";

export const metadataSchemaVersion = 2;
export const metadataSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS office_meta_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)`,
  `INSERT OR IGNORE INTO office_meta_schema VALUES(1,2)`,
  `CREATE TABLE IF NOT EXISTS office_meta_guard (token TEXT PRIMARY KEY,
    ok INTEGER NOT NULL CONSTRAINT office_metadata_guard CHECK(ok=1))`,
  `CREATE TABLE IF NOT EXISTS office_meta_documents (owner TEXT NOT NULL,id TEXT NOT NULL,unit TEXT NOT NULL,
    record TEXT NOT NULL,binding TEXT NOT NULL,PRIMARY KEY(owner,id),UNIQUE(owner,unit))`,
  `CREATE TABLE IF NOT EXISTS office_meta_drafts (owner TEXT NOT NULL,id TEXT NOT NULL,document TEXT NOT NULL,
    worktree TEXT NOT NULL,generation INTEGER NOT NULL,record TEXT NOT NULL,binding TEXT NOT NULL,
    PRIMARY KEY(owner,id),UNIQUE(owner,document,worktree))`,
  `CREATE TABLE IF NOT EXISTS office_meta_operations (owner TEXT NOT NULL,id TEXT NOT NULL,document TEXT NOT NULL,
    version INTEGER NOT NULL,phase TEXT NOT NULL,created INTEGER NOT NULL,record TEXT NOT NULL,
    claim_worker TEXT,claim_until INTEGER,PRIMARY KEY(owner,id))`,
  `CREATE INDEX IF NOT EXISTS office_meta_queue ON office_meta_operations(phase,created,owner,id)`,
  `CREATE INDEX IF NOT EXISTS office_meta_document_queue ON office_meta_operations(owner,document,phase)`,
  `CREATE TABLE IF NOT EXISTS office_meta_editors (owner TEXT NOT NULL,id TEXT NOT NULL,document TEXT NOT NULL,
    branch TEXT NOT NULL,epoch INTEGER NOT NULL,state TEXT NOT NULL,expires INTEGER NOT NULL,record TEXT NOT NULL,
    PRIMARY KEY(owner,id))`,
  `CREATE INDEX IF NOT EXISTS office_meta_editor_sessions ON office_meta_editors(owner,document,branch)`,
  `CREATE TABLE IF NOT EXISTS office_meta_reviews (owner TEXT NOT NULL,id TEXT NOT NULL,document TEXT NOT NULL,
    fingerprint TEXT NOT NULL,expires INTEGER NOT NULL,record TEXT NOT NULL,PRIMARY KEY(owner,id))`,
  `CREATE TABLE IF NOT EXISTS office_meta_approvals (owner TEXT NOT NULL,id TEXT NOT NULL,review TEXT NOT NULL,
    consumed_by TEXT,record TEXT NOT NULL,PRIMARY KEY(owner,id))`,
  `CREATE TABLE IF NOT EXISTS office_meta_barriers (owner TEXT NOT NULL,document TEXT NOT NULL,operation TEXT NOT NULL,
    state TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(owner,document))`,
  `CREATE TABLE IF NOT EXISTS office_meta_writes (owner TEXT NOT NULL,id TEXT NOT NULL,operation TEXT NOT NULL,
    document TEXT NOT NULL,phase TEXT NOT NULL,accepted_revision INTEGER,record TEXT NOT NULL,binding TEXT NOT NULL,
    PRIMARY KEY(owner,id))`,
  `CREATE INDEX IF NOT EXISTS office_meta_write_operation ON office_meta_writes(owner,operation,id)`,
  `CREATE TABLE IF NOT EXISTS office_meta_artifact_edges (owner TEXT NOT NULL,source TEXT NOT NULL,
    source_id TEXT NOT NULL,artifact TEXT NOT NULL,PRIMARY KEY(owner,source,source_id,artifact))`,
  `CREATE INDEX IF NOT EXISTS office_meta_artifact_reachable ON office_meta_artifact_edges(owner,artifact)`,
  `CREATE TABLE IF NOT EXISTS office_meta_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,
    document TEXT NOT NULL,record TEXT NOT NULL,native_sequence INTEGER,UNIQUE(owner,document,native_sequence))`,
  `CREATE INDEX IF NOT EXISTS office_meta_event_document ON office_meta_events(owner,document,sequence)`,
  ...sessionSchemaStatements,
  ...jobSchemaStatements,
  `CREATE TABLE IF NOT EXISTS office_bytes_objects (key TEXT PRIMARY KEY,owner TEXT NOT NULL,id TEXT NOT NULL,
    created INTEGER NOT NULL,state TEXT NOT NULL,digest TEXT,bytes INTEGER,etag TEXT)`,
  `CREATE INDEX IF NOT EXISTS office_bytes_orphans ON office_bytes_objects(owner,id,created)`,
  `CREATE TABLE IF NOT EXISTS office_bytes_refs (owner TEXT NOT NULL,id TEXT NOT NULL,key TEXT NOT NULL,
    created INTEGER NOT NULL,state TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(owner,id))`,
] as const;
export async function initializeOfficeMetadataSchema(database: D1Database): Promise<void> {
  const session = database.withSession("first-primary");
  const exists = await session
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='office_meta_schema'")
    .first();
  if (exists) await verify(database, true);
  // Version 1's unique branch writer index is policy, not content. Retire it without deleting sessions.
  // Stop the old application before upgrading; mixed v1/v2 writer policies are unsupported.
  await database.batch(
    [
      ...metadataSchemaStatements,
      "DROP INDEX IF EXISTS office_meta_editor_writer",
      "UPDATE office_meta_schema SET version=2 WHERE id=1 AND version=1",
    ].map((sql) => database.prepare(sql)),
  );
  await verify(database);
}
async function verify(database: D1Database, upgrading = false): Promise<void> {
  const row = await database
    .withSession("first-primary")
    .prepare("SELECT version FROM office_meta_schema WHERE id=1")
    .first<{ version: number }>();
  if (row?.version !== metadataSchemaVersion && !(upgrading && row?.version === 1))
    throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
}
