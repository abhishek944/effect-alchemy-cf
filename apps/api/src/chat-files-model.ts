/**
 * Shared private-file contract for the attachment node.
 *
 * A stored file is addressed only by (owner catalog scope, chat id, client
 * UUID). Storage keys, owner identity and original bytes never cross the
 * browser boundary: `FileDescriptor` from the parent-owned attachment schema is
 * the only public shape. Validation limits are imported from that schema so
 * this node cannot drift from the accepted product envelope.
 */
import { Schema } from "effect";
import type { FileDescriptor, FileKind } from "./chat-attachment-schema.ts";

/**
 * Application ceiling for one serialized native submission.
 *
 * Verified limitation: Cloudflare Durable Object SQL caps one row at 2 MiB, and
 * installed pi-durable writes the whole original input as one JSON value into
 * one `entries.record` row (`storage/sqlite/storage.js` INSERT INTO entries ...
 * encodeJson(write.value)) with no chunked image storage (`harness/submissions.js`
 * stores `model: [message]` once). 1.75 MiB of serialized content therefore
 * leaves a 0.25 MiB envelope reserve under the hard row limit. Images above this
 * ceiling are rejected with `native_storage_limit`; originals stay retained in
 * R2 at the approved 10 MiB product limit. Nothing is resized or truncated.
 */
export const MAX_NATIVE_SERIALIZED_BYTES = 1_835_008;
export const NATIVE_ENVELOPE_RESERVE_BYTES = 262_144;
/** A reserved upload lease is reclaimed only after this idle window. */
export const UPLOAD_LEASE_MS = 120_000;
/** A deferred acceptance probe is retried after this delay, never erased. */
export const ACCEPTANCE_RETRY_MS = 6 * 60 * 60 * 1000;
/** A failed byte deletion is retried after this delay until confirmed. */
export const PURGE_RETRY_MS = 6 * 60 * 60 * 1000;
export const STAGED_TTL_MS = 86_400_000;
export const SWEEP_BATCH_LIMIT = 32;

export const CHAT_FILES_FAILURES = [
  "invalid_input",
  "unsupported_type",
  "invalid_content",
  "file_too_large",
  "too_many_files",
  "message_too_large",
  "quoted_text_too_large",
  "attachment_conflict",
  "attachment_in_use",
  "upload_in_progress",
  "attachment_not_ready",
  "attachment_retired",
  "quota_exceeded",
  "model_image_unsupported",
  "model_image_limits",
  "native_storage_limit",
  "unavailable",
] as const;
export const ChatFilesFailure = Schema.Literals(CHAT_FILES_FAILURES);
export type ChatFilesFailure = typeof ChatFilesFailure.Type;

export type ChatFilesResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ChatFilesFailure };

export const filesOk = <T>(value: T): ChatFilesResult<T> => ({ ok: true, value });
export const filesFail = <T>(code: ChatFilesFailure): ChatFilesResult<T> => ({ ok: false, code });

export const CHAT_FILE_STATES = [
  "uploading",
  "ready",
  "accepted",
  "failed",
  "expired",
  "deleted",
] as const;
export type ChatFileState = (typeof CHAT_FILE_STATES)[number];

/** Server-side row shape; never serialized to a browser. */
export type ChatFileRecord = {
  readonly fileId: string;
  readonly chatId: string;
  readonly kind: FileKind;
  readonly name: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly digest: string;
  readonly state: ChatFileState;
  readonly width: number | null;
  readonly height: number | null;
  readonly excerpt: string | null;
  readonly createdAt: number;
  readonly stagedAt: number | null;
  readonly expiresAt: number | null;
  readonly acceptedAt: number | null;
  readonly checkedAt: number | null;
  readonly operationId: string | null;
};

/**
 * Conservative quota accounting: an uncertain `failed` upload and a
 * purge-pending tombstone still hold their bytes until a delete is confirmed.
 */
export const countsTowardQuota = (row: ChatFileRecord): boolean =>
  row.state === "deleted" || row.state === "expired" ? row.expiresAt !== null : true;

const iso = (milliseconds: number): string => new Date(milliseconds).toISOString();

const descriptorOf = (
  row: ChatFileRecord,
  state: FileDescriptor["state"],
  expiresAt: number | null,
): FileDescriptor => ({
  id: row.fileId,
  chatId: row.chatId,
  kind: row.kind,
  name: row.name,
  mediaType: row.mediaType,
  byteSize: row.byteSize,
  state,
  width: row.width,
  height: row.height,
  excerpt: row.excerpt,
  createdAt: iso(row.createdAt),
  expiresAt: expiresAt === null ? null : iso(expiresAt),
});

const PUBLIC_STATES = {
  uploading: "uploading",
  ready: "ready",
  accepted: "ready",
  failed: "failed",
  expired: "expired",
  deleted: "unavailable",
} as const satisfies Record<ChatFileState, FileDescriptor["state"]>;

/** Honest browser view of one stored file, including its live abandment deadline. */
export const publicDescriptor = (row: ChatFileRecord): FileDescriptor =>
  descriptorOf(row, PUBLIC_STATES[row.state], row.state === "ready" ? row.expiresAt : null);

/**
 * Descriptor snapshot for an accepted message: availability is retained, so the
 * uncommitted deadline is not part of the public message record.
 */
export const acceptedDescriptor = (row: ChatFileRecord): FileDescriptor =>
  descriptorOf(row, "ready", null);

export type ChatFileAcceptance = "accepted" | "absent" | "unknown";
export type ChatFileAcceptanceProbe = (input: {
  readonly operationId: string;
  readonly chatId: string;
}) => Promise<ChatFileAcceptance>;

/** Byte operations the reconciliation job performs through the CHAT_FILES binding. */
export type ChatFilesObjectStore = {
  readonly delete: (keys: readonly string[]) => Promise<void>;
  readonly copy: (fromKey: string, toKey: string) => Promise<boolean>;
};

export type ChatFilesSweepReport = {
  readonly deleted: number;
  readonly promoted: number;
  readonly failed: number;
  readonly deferred: number;
  readonly retainedBytes: number;
  readonly stagedBytes: number;
  readonly pendingBytes: number;
};
