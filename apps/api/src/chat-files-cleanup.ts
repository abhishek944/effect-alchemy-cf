/**
 * Abandoned-file reconciliation for one owner catalog.
 *
 * Three invariants, in order of importance:
 * 1. Accepted originals are never erased. The retained copy is only trusted
 *    when `objects.copy` resolves `true`; metadata promotes before the staging
 *    key is deleted, and a failed staging delete keeps a bounded purge retry.
 * 2. Tombstones (`deleted`/`expired`) are terminal: bytes stay purge-pending
 *    until a delete is confirmed, and a replayed UUID can never revive them.
 * 3. A bound row is probed for the exact native receipt before anything is
 *    erased: `accepted` promotes, `absent` purges, `unknown` keeps both bytes
 *    and metadata for a later retry.
 *
 * Every decision is re-fenced with a synchronous re-read so a row that was
 * bound, released or removed while an R2 operation was in flight is never
 * mutated from a stale snapshot.
 */
import {
  ACCEPTANCE_RETRY_MS,
  filesOk,
  PURGE_RETRY_MS,
  UPLOAD_LEASE_MS,
  type ChatFileAcceptance,
  type ChatFileAcceptanceProbe,
  type ChatFileRecord,
  type ChatFilesObjectStore,
  type ChatFilesResult,
  type ChatFilesSweepReport,
} from "./chat-files-model.ts";
import type { ChatSqlStorage } from "./chat-ledger.ts";
import {
  clearPurge,
  deferProbe,
  deferPurge,
  markTerminalBound,
  markTerminalUnbound,
  promoteAcceptedBound,
} from "./chat-files-mutations.ts";
import { retainedObjectKey, stagingObjectKey } from "./chat-files-store.ts";
import {
  awaitFileAttempt,
  fileSweepDiagnostics,
  type FileAttempt,
} from "./chat-files-sweep-diagnostics.ts";
import { fileRow, staleFileRows, usageBytes } from "./chat-files-table.ts";

/** Internal sweep dependency set; the catalog supplies its private db/scope. */
export type ChatFilesSweepInput = {
  readonly db: ChatSqlStorage;
  readonly scope: string;
  readonly now: number;
  readonly limit: number;
  readonly probe: ChatFileAcceptanceProbe;
  readonly objects: ChatFilesObjectStore;
};

/** Caller-facing sweep request; the catalog supplies the private db/scope pair. */
export type ChatFilesSweepRequest = Omit<ChatFilesSweepInput, "db" | "scope">;

/** Confirms a copy or delete; a rejected promise or an explicit `false` both fail. */
const confirmed = (task: Promise<boolean>): Promise<FileAttempt> => awaitFileAttempt(() => task);

/** Fresh unbound due check; a retried row with a new lease/deadline is not due. */
const unboundDue = (row: ChatFileRecord | null, now: number): boolean =>
  row !== null &&
  row.operationId === null &&
  ((row.state === "uploading" && row.createdAt <= now - UPLOAD_LEASE_MS) ||
    (row.state === "ready" && row.expiresAt !== null && row.expiresAt <= now));

const deleted = (objects: ChatFilesObjectStore, keys: readonly string[]): Promise<FileAttempt> =>
  awaitFileAttempt(async () => {
    await objects.delete(keys);
    return true;
  });

export const sweepChatFiles = async (
  input: ChatFilesSweepInput,
): Promise<ChatFilesResult<ChatFilesSweepReport>> => {
  let deletedCount = 0;
  let promoted = 0;
  let failed = 0;
  let deferred = 0;
  const diagnostics = fileSweepDiagnostics();
  const db = input.db;
  const due = staleFileRows(db, input.now, input.now - UPLOAD_LEASE_MS, input.limit);
  for (const row of due) {
    const stageKey = stagingObjectKey(input.scope, row.chatId, row.fileId);
    const retainKey = retainedObjectKey(input.scope, row.chatId, row.fileId);
    if (row.state === "deleted" || row.state === "expired") {
      const purged = await deleted(input.objects, [stageKey, retainKey]);
      if (!diagnostics.deleteFailed(purged)) clearPurge(db, row.fileId);
      else deferPurge(db, row.fileId, input.now, input.now + PURGE_RETRY_MS);
      deletedCount += purged.ok ? 1 : 0;
      deferred += purged.ok ? 0 : 1;
      continue;
    }
    if (row.state === "accepted") {
      // Only the redundant staging copy is purged; retained bytes stay untouched.
      const purged = await deleted(input.objects, [stageKey]);
      if (!diagnostics.deleteFailed(purged)) clearPurge(db, row.fileId);
      else deferPurge(db, row.fileId, input.now, input.now + PURGE_RETRY_MS);
      deletedCount += purged.ok ? 1 : 0;
      deferred += purged.ok ? 0 : 1;
      continue;
    }
    if (row.state === "failed") {
      // Uncertain PUT: only a fresh, still-due failed row is terminalized. A
      // same-UUID Retry that re-failed with a new deadline is left alone, and
      // there is no await between the due check and the terminal mark.
      const current = fileRow(db, row.fileId);
      if (
        current === null ||
        current.state !== "failed" ||
        current.operationId !== null ||
        current.expiresAt === null ||
        current.expiresAt > input.now
      ) {
        deferred += 1;
        continue;
      }
      markTerminalUnbound(db, row.fileId, "expired", input.now);
      const purged = await deleted(input.objects, [stageKey, retainKey]);
      if (!diagnostics.deleteFailed(purged)) clearPurge(db, row.fileId);
      else deferPurge(db, row.fileId, input.now, input.now + PURGE_RETRY_MS);
      deletedCount += purged.ok ? 1 : 0;
      deferred += purged.ok ? 0 : 1;
      continue;
    }
    if (row.state === "uploading" || row.operationId === null) {
      // Terminal and purge-deferred so a late upload callback can still be
      // cleaned by its own failed handler before the key is removed. The fresh
      // re-read must still be unbound and still due, so a retried row with a
      // new lease or a fresh 24h staged deadline is never expired.
      if (!unboundDue(fileRow(db, row.fileId), input.now)) {
        deferred += 1;
        continue;
      }
      markTerminalUnbound(db, row.fileId, "expired", input.now + UPLOAD_LEASE_MS);
      failed += 1;
      continue;
    }
    const operationId = row.operationId;
    let verdict: ChatFileAcceptance = "unknown";
    try {
      verdict = await input.probe({ operationId, chatId: row.chatId });
    } catch {
      verdict = "unknown";
    }
    const stillBound = (): ChatFileRecord | null => {
      const current = fileRow(db, row.fileId);
      return current !== null && current.state === "ready" && current.operationId === operationId
        ? current
        : null;
    };
    if (verdict === "accepted") {
      const copied = await confirmed(input.objects.copy(stageKey, retainKey));
      if (diagnostics.copyFailed(copied) || stillBound() === null) {
        deferProbe(db, row.fileId, input.now, input.now + ACCEPTANCE_RETRY_MS);
        deferred += 1;
        continue;
      }
      promoteAcceptedBound(db, row.fileId, operationId, input.now, input.now + PURGE_RETRY_MS);
      const purged = await deleted(input.objects, [stageKey]);
      if (!diagnostics.deleteFailed(purged))
        deferPurge(db, row.fileId, input.now, input.now + PURGE_RETRY_MS);
      promoted += 1;
      continue;
    }
    if (verdict === "absent") {
      if (stillBound() === null) {
        deferred += 1;
        continue;
      }
      markTerminalBound(db, row.fileId, operationId, input.now);
      const purged = await deleted(input.objects, [stageKey, retainKey]);
      if (!diagnostics.deleteFailed(purged)) clearPurge(db, row.fileId);
      else deferPurge(db, row.fileId, input.now, input.now + PURGE_RETRY_MS);
      deletedCount += purged.ok ? 1 : 0;
      deferred += purged.ok ? 0 : 1;
      continue;
    }
    deferProbe(db, row.fileId, input.now, input.now + ACCEPTANCE_RETRY_MS);
    deferred += 1;
  }
  diagnostics.report();
  const usage = usageBytes(db);
  return filesOk({
    deleted: deletedCount,
    promoted,
    failed,
    deferred,
    retainedBytes: usage.retained,
    stagedBytes: usage.staged,
    pendingBytes: usage.pending,
  });
};
