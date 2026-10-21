import type { D1Database } from "@cloudflare/workers-types";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";

export const coordinatorSchemaVersion = 1;
export const coordinatorSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS office_coord_schema (
    id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL)`,
  `INSERT OR IGNORE INTO office_coord_schema VALUES(1,1)`,
  `CREATE TABLE IF NOT EXISTS office_coord_documents (
    owner TEXT NOT NULL,document TEXT NOT NULL,unit TEXT NOT NULL,scope TEXT NOT NULL UNIQUE,
    authority_epoch INTEGER NOT NULL CHECK(authority_epoch>0),
    service_epoch INTEGER NOT NULL CHECK(service_epoch>0),
    placement_id TEXT NOT NULL,placement_until INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('live','retired')),
    turn_fence INTEGER NOT NULL DEFAULT 0 CHECK(turn_fence>=0),current_turn TEXT,
    PRIMARY KEY(owner,document))`,
  `CREATE TABLE IF NOT EXISTS office_coord_placements (
    id TEXT PRIMARY KEY,owner TEXT NOT NULL,document TEXT NOT NULL,unit TEXT NOT NULL,
    scope TEXT NOT NULL,node TEXT NOT NULL,authority_epoch INTEGER NOT NULL,service_epoch INTEGER NOT NULL,
    deadline INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('live','retired')),
    request TEXT NOT NULL,record TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS office_coord_placement_document ON office_coord_placements(owner,document)`,
  `CREATE TABLE IF NOT EXISTS office_coord_turns (
    id TEXT PRIMARY KEY,owner TEXT NOT NULL,document TEXT NOT NULL,scope TEXT NOT NULL,
    placement_id TEXT NOT NULL,command_id TEXT NOT NULL,step_id TEXT NOT NULL,
    authority_epoch INTEGER NOT NULL,service_epoch INTEGER NOT NULL,
    version INTEGER NOT NULL CHECK(version>0),fence INTEGER NOT NULL CHECK(fence>0),
    mode TEXT NOT NULL CHECK(mode IN ('native','metadata','proof')),
    state TEXT NOT NULL CHECK(state IN ('held','released','expired')),
    deadline INTEGER NOT NULL,auth_until INTEGER NOT NULL,authorization_digest TEXT NOT NULL,
    subject TEXT NOT NULL CHECK(subject IN ('core','editor')),
    editor_id TEXT,editor_epoch INTEGER,channel_id TEXT,request TEXT NOT NULL,record TEXT NOT NULL,
    UNIQUE(scope,command_id,step_id))`,
  `CREATE INDEX IF NOT EXISTS office_coord_turn_document ON office_coord_turns(owner,document,state)`,
  `CREATE TABLE IF NOT EXISTS office_coord_preparations (
    scope TEXT NOT NULL,command_id TEXT NOT NULL,step_id TEXT NOT NULL,action TEXT NOT NULL,
    write_id TEXT NOT NULL,payload_digest TEXT NOT NULL,fingerprint TEXT NOT NULL,original_epoch INTEGER NOT NULL,
    turn_id TEXT NOT NULL,turn_fence INTEGER NOT NULL,
    PRIMARY KEY(scope,command_id,step_id,action),UNIQUE(scope,write_id))`,
  `CREATE TABLE IF NOT EXISTS office_coord_channels (
    id TEXT PRIMARY KEY,owner TEXT NOT NULL,document TEXT NOT NULL,unit TEXT NOT NULL,
    editor_id TEXT NOT NULL,editor_epoch INTEGER NOT NULL,view_id TEXT NOT NULL,
    principal TEXT NOT NULL,session_epoch INTEGER NOT NULL,member_id TEXT NOT NULL,
    deadline INTEGER NOT NULL,version INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('live','revoked')),record TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS office_coord_channel_editor ON office_coord_channels(owner,document,editor_id)`,
  `CREATE TABLE IF NOT EXISTS office_coord_editor_submissions (
    id TEXT PRIMARY KEY,scope TEXT NOT NULL,branch TEXT NOT NULL,sid TEXT NOT NULL,req_id INTEGER NOT NULL,
    channel_id TEXT NOT NULL,editor_id TEXT NOT NULL,editor_epoch INTEGER NOT NULL,turn_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('admitted','staged','prepared','confirmed','unknown','rejected')),
    client_ref TEXT NOT NULL,leaf_record TEXT,prepared_record TEXT,accepted_revision INTEGER,
    UNIQUE(scope,branch,sid,req_id))`,
  `CREATE TABLE IF NOT EXISTS office_coord_accepted_headers (
    scope TEXT NOT NULL,command_id TEXT NOT NULL,step_id TEXT NOT NULL,action TEXT NOT NULL,
    write_id TEXT NOT NULL,payload_digest TEXT NOT NULL,fingerprint TEXT NOT NULL,original_epoch INTEGER NOT NULL,
    value_hash TEXT NOT NULL,PRIMARY KEY(scope,command_id,step_id,action))`,
  `CREATE TABLE IF NOT EXISTS office_coord_ready_projections (
    owner TEXT NOT NULL,operation TEXT NOT NULL,document TEXT NOT NULL,digest TEXT NOT NULL,
    intent_digest TEXT NOT NULL,lineage_digest TEXT NOT NULL,record TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('sealed','published')),confirmed_version INTEGER,
    CHECK((state='sealed' AND confirmed_version IS NULL) OR (state='published' AND confirmed_version IS NOT NULL)),
    PRIMARY KEY(owner,operation))`,
  `CREATE TABLE IF NOT EXISTS office_coord_native_files (
    owner TEXT NOT NULL,document TEXT NOT NULL,unit TEXT NOT NULL,file_id TEXT NOT NULL,
    ref_id TEXT NOT NULL,ref_record TEXT NOT NULL,PRIMARY KEY(owner,document,unit,file_id))`,
] as const;

/** Separate additive v1. It never rewrites base metadata/native versions or original prepared slots. */
export async function initializeCoordinatorSchema(database: D1Database): Promise<void> {
  const existing = await database
    .withSession("first-primary")
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='office_coord_schema'")
    .first();
  if (existing) await requireCoordinatorSchema(database);
  await database.batch(coordinatorSchemaStatements.map((sql) => database.prepare(sql)));
  await requireCoordinatorSchema(database);
}
export async function requireCoordinatorSchema(database: D1Database): Promise<void> {
  const row = await database
    .withSession("first-primary")
    .prepare("SELECT version FROM office_coord_schema WHERE id=1")
    .first<{ version: number }>();
  if (row?.version !== coordinatorSchemaVersion)
    throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
}
