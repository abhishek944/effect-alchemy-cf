/**
 * Owner-catalog file policy: quota, idempotency and operation binding.
 *
 * One instance per owner (inside ChatCatalog) serializes the 1 GiB retained
 * quota and every transition. Rows are never removed: accepted bindings stay
 * permanent and abandoned rows are tombstoned, so a replayed UUID cannot
 * silently reuse old bytes.
 */
import type { FileDescriptor } from "./chat-attachment-schema.ts";
import { RETAINED_BYTES_PER_USER } from "./chat-attachment-schema.ts";
import type { ChatSqlStorage } from "./chat-ledger.ts";
import { sweepChatFiles, type ChatFilesSweepRequest } from "./chat-files-cleanup.ts";
import {
  acceptedDescriptor,
  countsTowardQuota,
  filesFail,
  filesOk,
  publicDescriptor,
  PURGE_RETRY_MS,
  STAGED_TTL_MS,
  type ChatFilesResult,
  type ChatFilesSweepReport,
} from "./chat-files-model.ts";
import type {
  ChatFilesAbort,
  ChatFilesCommit,
  ChatFilesPrepare,
  ChatFilesPrepareResult,
  ChatFilesRelease,
  ChatFilesRemove,
  ChatFilesRemoveResult,
  ChatFilesReserve,
  ChatFilesReserveResult,
  ChatFilesStaged,
  ChatFilesUsageView,
} from "./chat-files-ops.ts";
import {
  bindOperation,
  clearOperation,
  insertUploading,
  markStaged,
  markTerminalUnbound,
  markUploadFailed,
  promoteAccepted,
  updateForUpload,
} from "./chat-files-mutations.ts";
import {
  ensureChatFilesSchema,
  fileRow,
  fileRows,
  listFileRows,
  usageBytes,
} from "./chat-files-table.ts";

export class ChatFilesCatalog {
  private readonly db: ChatSqlStorage;
  private readonly scope: string;
  constructor(options: { readonly db: ChatSqlStorage; readonly scope: string }) {
    this.db = options.db;
    this.scope = options.scope;
    ensureChatFilesSchema(this.db);
  }
  usage(): ChatFilesUsageView {
    const bytes = usageBytes(this.db);
    return {
      retainedBytes: bytes.retained,
      stagedBytes: bytes.staged,
      reservedBytes: bytes.reserved,
      pendingBytes: bytes.pending,
      usedBytes: bytes.retained + bytes.staged + bytes.reserved + bytes.pending,
      quotaBytes: RETAINED_BYTES_PER_USER,
    };
  }
  /** Reserves quota before bytes leave the request; identical bytes are idempotent. */
  reserve(input: ChatFilesReserve): ChatFilesResult<ChatFilesReserveResult> {
    const existing = fileRow(this.db, input.fileId);
    if (existing !== null && (existing.state === "deleted" || existing.state === "expired"))
      return filesFail("attachment_retired");
    const mismatched =
      existing !== null && (existing.chatId !== input.chatId || existing.digest !== input.digest);
    if (mismatched) return filesFail("attachment_conflict");
    // A concurrent upload of the same UUID owns the shared staging key; a second
    // writer must never race a failed `staged` into deleting accepted bytes.
    if (existing !== null && existing.state === "uploading") return filesFail("upload_in_progress");
    if (existing !== null && (existing.state === "ready" || existing.state === "accepted"))
      return filesOk({ status: "existing", file: publicDescriptor(existing) });
    const held = existing !== null && countsTowardQuota(existing) ? existing.byteSize : 0;
    if (this.usage().usedBytes - held + input.byteSize > RETAINED_BYTES_PER_USER)
      return filesFail("quota_exceeded");
    if (existing === null) insertUploading(this.db, input);
    else updateForUpload(this.db, input);
    const row = fileRow(this.db, input.fileId);
    return row === null
      ? filesFail("unavailable")
      : filesOk({ status: "reserved", file: publicDescriptor(row) });
  }
  /** Confirms stored bytes; the 24h abandoned deadline starts here. */
  staged(input: ChatFilesStaged): ChatFilesResult<FileDescriptor> {
    const changed = markStaged(
      this.db,
      input.fileId,
      input.chatId,
      input.now,
      input.now + STAGED_TTL_MS,
    );
    if (changed === 0) return filesFail("attachment_not_ready");
    const row = fileRow(this.db, input.fileId);
    return row === null ? filesFail("unavailable") : filesOk(publicDescriptor(row));
  }
  /**
   * A failed PUT may still have committed; the row stays quota-holding and
   * purge-due after the abandoned TTL, and may be retried before that.
   */
  abort(input: ChatFilesAbort): void {
    markUploadFailed(this.db, input.fileId, input.now + STAGED_TTL_MS);
  }
  /** Binds staged files to one operation before native submission; retry-safe. */
  prepare(input: ChatFilesPrepare): ChatFilesResult<ChatFilesPrepareResult> {
    const rows = fileRows(this.db, input.fileIds);
    if (rows.length !== input.fileIds.length) return filesFail("attachment_not_ready");
    let byteSize = 0;
    let hasImage = false;
    for (const row of rows) {
      if (row.chatId !== input.chatId) return filesFail("attachment_conflict");
      if (row.state === "accepted") {
        if (row.operationId !== input.operationId) return filesFail("attachment_in_use");
        byteSize += row.byteSize;
        if (row.kind === "image") hasImage = true;
        continue;
      }
      if (row.state !== "ready") return filesFail("attachment_not_ready");
      if (row.operationId !== null && row.operationId !== input.operationId)
        return filesFail("attachment_in_use");
      if (row.expiresAt !== null && row.expiresAt <= input.now)
        return filesFail("attachment_not_ready");
      byteSize += row.byteSize;
      if (row.kind === "image") hasImage = true;
    }
    for (const row of rows) {
      if (row.state === "ready" && row.operationId === null)
        bindOperation(this.db, row.fileId, input.operationId);
    }
    return filesOk({
      files: rows.map((row) => acceptedDescriptor(row)),
      digests: rows.map((row) => row.digest),
      byteSize,
      hasImage,
    });
  }
  /** Promotes bound files after native acceptance; retained bytes must exist first. */
  commit(input: ChatFilesCommit): ChatFilesResult<{ readonly files: readonly FileDescriptor[] }> {
    const rows = fileRows(this.db, input.fileIds);
    if (rows.length !== input.fileIds.length) return filesFail("attachment_not_ready");
    for (const row of rows) {
      if (row.chatId !== input.chatId) return filesFail("attachment_conflict");
      if (row.state === "accepted") {
        if (row.operationId !== input.operationId) return filesFail("attachment_conflict");
        continue;
      }
      if (row.state !== "ready" || row.operationId !== input.operationId)
        return filesFail(row.state === "ready" ? "attachment_in_use" : "attachment_not_ready");
    }
    for (const row of rows) {
      if (row.state !== "accepted")
        promoteAccepted(this.db, row.fileId, input.now, input.now + PURGE_RETRY_MS);
    }
    const final = fileRows(this.db, input.fileIds);
    return final.length === rows.length
      ? filesOk({ files: final.map(acceptedDescriptor) })
      : filesFail("unavailable");
  }
  /** Frees a failed or uncertain send binding so files stay retryable/removable. */
  release(input: ChatFilesRelease): number {
    return clearOperation(this.db, input.operationId, input.chatId);
  }
  /** Removes only abandoned/uncommitted files; accepted originals are permanent. */
  remove(input: ChatFilesRemove): ChatFilesRemoveResult {
    const row = fileRow(this.db, input.fileId);
    if (row === null || row.chatId !== input.chatId || row.state === "deleted") return "not_found";
    if (row.state === "accepted" || row.operationId !== null) return "in_use";
    markTerminalUnbound(this.db, row.fileId, "deleted", input.now);
    return "removed";
  }
  get(chatId: string, fileId: string): FileDescriptor | null {
    const row = fileRow(this.db, fileId);
    if (row === null || row.chatId !== chatId || row.state === "deleted") return null;
    return publicDescriptor(row);
  }
  /** Visible live files for one chat; parent snapshots filter as needed. */
  list(chatId: string): readonly FileDescriptor[] {
    return listFileRows(this.db, chatId).map(publicDescriptor);
  }
  /** Abandoned-expiry reconciliation; owns the private db/scope pair. */
  sweep(input: ChatFilesSweepRequest): Promise<ChatFilesResult<ChatFilesSweepReport>> {
    return sweepChatFiles({ ...input, db: this.db, scope: this.scope });
  }
}
