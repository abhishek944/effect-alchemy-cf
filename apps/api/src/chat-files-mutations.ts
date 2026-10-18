/**
 * State mutations for owner-catalog file metadata.
 *
 * Kept beside `chat-files-table.ts` reads so the `files` table has one SQL
 * owner. Policy decisions stay in `chat-files-catalog.ts`.
 */
import type { ChatSqlStorage } from "./chat-ledger.ts";
import type { ChatFilesReserve } from "./chat-files-ops.ts";
import { COLUMNS } from "./chat-files-table.ts";

export const insertUploading = (db: ChatSqlStorage, input: ChatFilesReserve): void => {
  db.exec(
    `INSERT INTO files (${COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)`,
    input.fileId,
    input.chatId,
    input.kind,
    input.name,
    input.mediaType,
    input.byteSize,
    input.digest,
    input.width,
    input.height,
    input.excerpt,
    input.now,
  );
};

export const updateForUpload = (db: ChatSqlStorage, input: ChatFilesReserve): void => {
  db.exec(
    `UPDATE files SET kind = ?, name = ?, media_type = ?, byte_size = ?, state = 'uploading',
     width = ?, height = ?, excerpt = ?, created_at = ?, staged_at = NULL, expires_at = NULL,
     accepted_at = NULL, checked_at = NULL, operation_id = NULL WHERE file_id = ?`,
    input.kind,
    input.name,
    input.mediaType,
    input.byteSize,
    input.width,
    input.height,
    input.excerpt,
    input.now,
    input.fileId,
  );
};

export const markStaged = (
  db: ChatSqlStorage,
  fileId: string,
  chatId: string,
  now: number,
  expiresAt: number,
): number =>
  db.exec(
    `UPDATE files SET state = 'ready', staged_at = ?, expires_at = ?, checked_at = NULL
     WHERE file_id = ? AND chat_id = ? AND state = 'uploading'`,
    now,
    expiresAt,
    fileId,
    chatId,
  ).rowsWritten;

/** A failed PUT may have committed despite a lost acknowledgement, so the row
 * keeps a bounded purge deadline, holds quota until cleanup confirms deletion,
 * and a same-UUID Retry before the deadline revives it safely. */
export const markUploadFailed = (db: ChatSqlStorage, fileId: string, purgeAt: number): void => {
  db.exec(
    `UPDATE files SET state = 'failed', expires_at = ?, checked_at = NULL
     WHERE file_id = ? AND state = 'uploading'`,
    purgeAt,
    fileId,
  );
};

export const bindOperation = (db: ChatSqlStorage, fileId: string, operationId: string): void => {
  db.exec(
    `UPDATE files SET operation_id = ? WHERE file_id = ? AND state = 'ready'`,
    operationId,
    fileId,
  );
};

export const clearOperation = (db: ChatSqlStorage, operationId: string, chatId: string): number =>
  db.exec(
    `UPDATE files SET operation_id = NULL
     WHERE operation_id = ? AND chat_id = ? AND state = 'ready'`,
    operationId,
    chatId,
  ).rowsWritten;

/**
 * Promotes to accepted and schedules the staging-key purge. A failed staging
 * delete is therefore retried until confirmed without ever touching the
 * retained copy.
 */
export const promoteAccepted = (
  db: ChatSqlStorage,
  fileId: string,
  now: number,
  purgeAt: number,
): void => {
  db.exec(
    `UPDATE files SET state = 'accepted', accepted_at = ?, expires_at = ?, checked_at = ?
     WHERE file_id = ? AND state IN ('uploading', 'ready')`,
    now,
    purgeAt,
    now,
    fileId,
  );
};

/**
 * Terminal tombstone for a definitively unbound row. The `operation_id IS NULL`
 * guard means a row bound while cleanup was in flight is never expired.
 */
export const markTerminalUnbound = (
  db: ChatSqlStorage,
  fileId: string,
  state: "deleted" | "expired",
  purgeAt: number,
): number =>
  db.exec(
    `UPDATE files SET state = ?, expires_at = ?, checked_at = NULL
     WHERE file_id = ? AND state IN ('uploading', 'ready', 'failed') AND operation_id IS NULL`,
    state,
    purgeAt,
    fileId,
  ).rowsWritten;

/** Terminal tombstone fenced to the exact probed operation that was rejected. */
export const markTerminalBound = (
  db: ChatSqlStorage,
  fileId: string,
  operationId: string,
  purgeAt: number,
): number =>
  db.exec(
    `UPDATE files SET state = 'expired', expires_at = ?, checked_at = NULL
     WHERE file_id = ? AND state = 'ready' AND operation_id = ?`,
    purgeAt,
    fileId,
    operationId,
  ).rowsWritten;

/** Promotion fenced to the exact probed operation, for post-copy reconciliation. */
export const promoteAcceptedBound = (
  db: ChatSqlStorage,
  fileId: string,
  operationId: string,
  now: number,
  purgeAt: number,
): number =>
  db.exec(
    `UPDATE files SET state = 'accepted', accepted_at = ?, expires_at = ?, checked_at = ?
     WHERE file_id = ? AND state = 'ready' AND operation_id = ?`,
    now,
    purgeAt,
    now,
    fileId,
    operationId,
  ).rowsWritten;

/** Retry a failed byte deletion; terminal and accepted staging purges only. */
export const deferPurge = (
  db: ChatSqlStorage,
  fileId: string,
  now: number,
  retryAt: number,
): void => {
  db.exec(
    `UPDATE files SET checked_at = ?, expires_at = ?
     WHERE file_id = ? AND state IN ('deleted', 'expired', 'accepted')`,
    now,
    retryAt,
    fileId,
  );
};

/** Confirmed deletion clears the maintenance deadline; the tombstone row stays. */
export const clearPurge = (db: ChatSqlStorage, fileId: string): void => {
  db.exec(
    `UPDATE files SET checked_at = NULL, expires_at = NULL
     WHERE file_id = ? AND state IN ('deleted', 'expired', 'accepted')`,
    fileId,
  );
};

export const deferProbe = (
  db: ChatSqlStorage,
  fileId: string,
  now: number,
  retryAt: number,
): void => {
  db.exec(
    `UPDATE files SET checked_at = ?, expires_at = ?
     WHERE file_id = ? AND state IN ('uploading', 'ready')`,
    now,
    retryAt,
    fileId,
  );
};
