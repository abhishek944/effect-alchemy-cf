/**
 * Owner-catalog storage rows for the private skill library.
 *
 * Every query is scoped by the caller's catalog storage, so owner identity is
 * the object instance rather than any request value. Manifests are stored as
 * the parent-owned schema document and decoded here before semantic verification.
 */
import type { AgentContext } from "agents";
import {
  type SkillFile,
  type SkillReservation,
  type SkillUploadReceipt,
  type SkillVersionRef,
} from "./skills-model.ts";

export type SkillStorage = AgentContext["storage"];

export type SkillFileRow = {
  readonly id: string;
  readonly filename: string;
  readonly name_key: string;
  readonly version: string;
  readonly digest: string;
  readonly byte_size: number;
  readonly created_at: number;
  readonly updated_at: number;
};

export type SkillVersionRow = {
  readonly version: string;
  readonly skill_id: string;
  readonly upload_id: string;
  readonly filename: string;
  readonly digest: string;
  readonly byte_size: number;
  readonly state: string;
  readonly created_at: number;
  readonly published_at: number | null;
  readonly published_revision: string | null;
};

export type SkillUploadRow = {
  readonly upload_id: string;
  readonly filename: string;
  readonly name_key: string;
  readonly digest: string;
  readonly byte_size: number;
  readonly replace_version: string | null;
  readonly skill_id: string;
  readonly version: string;
  readonly state: string;
  readonly revision: string | null;
  readonly created_at: number;
  readonly updated_at: number;
};

export const ensureSkillSchema = (storage: SkillStorage): void => {
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS skill_files (
    id TEXT PRIMARY KEY, filename TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
    version TEXT NOT NULL, digest TEXT NOT NULL, byte_size INTEGER NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS skill_versions (
    version TEXT PRIMARY KEY, skill_id TEXT NOT NULL, upload_id TEXT NOT NULL,
    filename TEXT NOT NULL, digest TEXT NOT NULL, byte_size INTEGER NOT NULL,
    state TEXT NOT NULL, created_at INTEGER NOT NULL, published_at INTEGER,
    published_revision TEXT
  )`);
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS skill_uploads (
    upload_id TEXT PRIMARY KEY, filename TEXT NOT NULL, name_key TEXT NOT NULL,
    digest TEXT NOT NULL, byte_size INTEGER NOT NULL, replace_version TEXT,
    skill_id TEXT NOT NULL, version TEXT NOT NULL, state TEXT NOT NULL,
    revision TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS skill_manifests (
    revision TEXT PRIMARY KEY, document TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS skill_head (
    id INTEGER PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL
  )`);
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS skill_cancel_tombstones (
    upload_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL
  )`);
  storage.sql.exec(
    `CREATE INDEX IF NOT EXISTS skill_versions_state_idx ON skill_versions(state, created_at)`,
  );
};

export const skillFileByName = (storage: SkillStorage, nameKey: string): SkillFileRow | null =>
  storage.sql
    .exec<SkillFileRow>(`SELECT * FROM skill_files WHERE name_key = ?`, nameKey)
    .toArray()[0] ?? null;

export const skillFileRows = (storage: SkillStorage): readonly SkillFileRow[] =>
  storage.sql.exec<SkillFileRow>(`SELECT * FROM skill_files`).toArray();

export const skillVersionRow = (storage: SkillStorage, version: string): SkillVersionRow | null =>
  storage.sql
    .exec<SkillVersionRow>(`SELECT * FROM skill_versions WHERE version = ?`, version)
    .toArray()[0] ?? null;

export const skillUploadRow = (storage: SkillStorage, uploadId: string): SkillUploadRow | null =>
  storage.sql
    .exec<SkillUploadRow>(`SELECT * FROM skill_uploads WHERE upload_id = ?`, uploadId)
    .toArray()[0] ?? null;

export const skillHead = (storage: SkillStorage): string | null =>
  storage.sql
    .exec<{ revision: string }>(`SELECT revision FROM skill_head WHERE id = 1`)
    .toArray()[0]?.revision ?? null;

/** Retained versions exclude permanent expired tombstones, which hold no bytes. */
export const skillVersionCount = (storage: SkillStorage): number =>
  storage.sql
    .exec<{ count: number }>(
      `SELECT COUNT(*) AS count FROM skill_versions WHERE state != 'expired'`,
    )
    .toArray()[0]?.count ?? 0;

export const skillStorageBytes = (storage: SkillStorage): number =>
  storage.sql
    .exec<{ bytes: number | null }>(`SELECT SUM(byte_size) AS bytes FROM skill_versions`)
    .toArray()[0]?.bytes ?? 0;

/** Cumulative intents include published/expired uploads and negative tombstones. */
export const skillIntentCount = (storage: SkillStorage): number =>
  storage.sql
    .exec<{ count: number }>(
      `SELECT (SELECT COUNT(*) FROM skill_uploads) + (SELECT COUNT(*) FROM skill_cancel_tombstones) AS count`,
    )
    .toArray()[0]?.count ?? 0;

/** A never-seen upload id explicitly cancelled by its owner; permanent. */
export const skillCancelTombstone = (storage: SkillStorage, uploadId: string): boolean =>
  storage.sql
    .exec<{ upload_id: string }>(
      `SELECT upload_id FROM skill_cancel_tombstones WHERE upload_id = ?`,
      uploadId,
    )
    .toArray()[0] !== undefined;

export const insertSkillCancelTombstone = (
  storage: SkillStorage,
  uploadId: string,
  now: number,
): void => {
  storage.sql.exec(
    `INSERT OR IGNORE INTO skill_cancel_tombstones (upload_id, created_at) VALUES (?, ?)`,
    uploadId,
    now,
  );
};

export const skillFileOf = (row: SkillFileRow): SkillFile => ({
  id: row.id,
  filename: row.filename,
  version: row.version,
});

export const skillRefOfVersion = (row: SkillVersionRow): SkillVersionRef => ({
  id: row.skill_id,
  filename: row.filename,
  version: row.version,
  digest: row.digest,
  byteSize: row.byte_size,
});

export const skillReservationOf = (scope: string, row: SkillUploadRow): SkillReservation => ({
  uploadId: row.upload_id,
  ownerScope: scope,
  file: {
    id: row.skill_id,
    filename: row.filename,
    version: row.version,
    digest: row.digest,
    byteSize: row.byte_size,
  },
  revision: row.state === "published" ? row.revision : null,
});

export const skillReceiptOf = (row: SkillUploadRow): SkillUploadReceipt | null => {
  if (row.state === "expired") return { uploadId: row.upload_id, state: "expired" };
  if (row.state !== "published") return { uploadId: row.upload_id, state: "pending" };
  if (row.revision === null) return null;
  return {
    uploadId: row.upload_id,
    state: "published",
    revision: row.revision,
    file: { id: row.skill_id, filename: row.filename, version: row.version },
  };
};
