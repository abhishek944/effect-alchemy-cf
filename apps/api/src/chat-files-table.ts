/**
 * Raw SQL primitives for owner-catalog file metadata.
 *
 * All file state lives in one owner actor, so these statements are the only
 * place that touches the `files` table. Policy (quota, idempotency, binding
 * decisions) stays in `chat-files-catalog.ts`.
 */
import type { ChatSqlStorage } from "./chat-ledger.ts";
import { ensureImageStorageSchema } from "./chat-image-storage-table.ts";
import { CHAT_FILE_STATES, type ChatFileRecord, type ChatFileState } from "./chat-files-model.ts";

type RawFileRow = {
  readonly file_id: string;
  readonly chat_id: string;
  readonly kind: string;
  readonly name: string;
  readonly media_type: string;
  readonly byte_size: number;
  readonly digest: string;
  readonly state: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly excerpt: string | null;
  readonly created_at: number;
  readonly staged_at: number | null;
  readonly expires_at: number | null;
  readonly accepted_at: number | null;
  readonly checked_at: number | null;
  readonly operation_id: string | null;
};

export const COLUMNS = [
  "file_id",
  "chat_id",
  "kind",
  "name",
  "media_type",
  "byte_size",
  "digest",
  "state",
  "width",
  "height",
  "excerpt",
  "created_at",
  "staged_at",
  "expires_at",
  "accepted_at",
  "checked_at",
  "operation_id",
].join(", ");

const asState = (value: string): ChatFileState =>
  CHAT_FILE_STATES.find((state) => state === value) ?? "deleted";
const asKind = (value: string): ChatFileRecord["kind"] => {
  if (value === "image" || value === "text" || value === "office") return value;
  throw new Error("Unknown chat file kind");
};

const toRecord = (row: RawFileRow): ChatFileRecord => ({
  fileId: row.file_id,
  chatId: row.chat_id,
  kind: asKind(row.kind),
  name: row.name,
  mediaType: row.media_type,
  byteSize: row.byte_size,
  digest: row.digest,
  state: asState(row.state),
  width: row.width,
  height: row.height,
  excerpt: row.excerpt,
  createdAt: row.created_at,
  stagedAt: row.staged_at,
  expiresAt: row.expires_at,
  acceptedAt: row.accepted_at,
  checkedAt: row.checked_at,
  operationId: row.operation_id,
});

export const ensureChatFilesSchema = (db: ChatSqlStorage): void => {
  ensureImageStorageSchema(db);
  db.exec(
    `CREATE TABLE IF NOT EXISTS files (
      file_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, kind TEXT NOT NULL,
      name TEXT NOT NULL, media_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
      digest TEXT NOT NULL, state TEXT NOT NULL, width INTEGER, height INTEGER,
      excerpt TEXT, created_at INTEGER NOT NULL, staged_at INTEGER,
      expires_at INTEGER, accepted_at INTEGER, checked_at INTEGER, operation_id TEXT
    )`,
  );
  db.exec(`CREATE INDEX IF NOT EXISTS files_chat_state ON files (chat_id, state)`);
  db.exec(`CREATE INDEX IF NOT EXISTS files_sweep ON files (state, expires_at)`);
};

export const fileRow = (db: ChatSqlStorage, fileId: string): ChatFileRecord | null => {
  const raw = db
    .exec<RawFileRow>(`SELECT ${COLUMNS} FROM files WHERE file_id = ?`, fileId)
    .toArray()[0];
  return raw === undefined ? null : toRecord(raw);
};

export const fileRows = (
  db: ChatSqlStorage,
  fileIds: readonly string[],
): readonly ChatFileRecord[] => {
  if (fileIds.length === 0) return [];
  const placeholders = fileIds.map(() => "?").join(", ");
  const rows = db
    .exec<RawFileRow>(`SELECT ${COLUMNS} FROM files WHERE file_id IN (${placeholders})`, ...fileIds)
    .toArray()
    .map(toRecord);
  const byId = new Map(rows.map((row) => [row.fileId, row]));
  return fileIds.flatMap((fileId) => {
    const row = byId.get(fileId);
    return row === undefined ? [] : [row];
  });
};

export type UsageBytes = {
  readonly retained: number;
  readonly staged: number;
  readonly reserved: number;
  readonly pending: number;
};

export const usageBytes = (db: ChatSqlStorage): UsageBytes =>
  db
    .exec<UsageBytes>(
      `SELECT
        COALESCE(SUM(CASE WHEN state = 'accepted' THEN byte_size ELSE 0 END), 0) AS retained,
        COALESCE(SUM(CASE WHEN state = 'ready' THEN byte_size ELSE 0 END), 0) AS staged,
        (COALESCE(SUM(CASE WHEN state = 'uploading' THEN byte_size ELSE 0 END), 0)
          + (SELECT COALESCE(SUM(remaining_bytes), 0) FROM image_calls)) AS reserved,
        COALESCE(SUM(CASE WHEN state = 'failed'
            OR (state IN ('deleted', 'expired') AND expires_at IS NOT NULL)
          THEN byte_size ELSE 0 END), 0) AS pending
       FROM files`,
    )
    .one();

/** Due maintenance: staged expiry, stale uploads, uncertain uploads, pending purges. */
export const staleFileRows = (
  db: ChatSqlStorage,
  now: number,
  staleUploadBefore: number,
  limit: number,
): readonly ChatFileRecord[] =>
  db
    .exec<RawFileRow>(
      `SELECT ${COLUMNS} FROM files
       WHERE (state = 'ready' AND expires_at IS NOT NULL AND expires_at <= ?)
          OR (state = 'uploading' AND created_at <= ?)
          OR (state IN ('failed', 'deleted', 'expired', 'accepted')
              AND expires_at IS NOT NULL AND expires_at <= ?)
       ORDER BY created_at ASC LIMIT ?`,
      now,
      staleUploadBefore,
      now,
      limit,
    )
    .toArray()
    .map(toRecord);

export const listFileRows = (db: ChatSqlStorage, chatId: string): readonly ChatFileRecord[] =>
  db
    .exec<RawFileRow>(
      `SELECT ${COLUMNS} FROM files WHERE chat_id = ? AND state IN ('ready', 'accepted')
       ORDER BY created_at ASC, file_id ASC LIMIT 200`,
      chatId,
    )
    .toArray()
    .map(toRecord);
