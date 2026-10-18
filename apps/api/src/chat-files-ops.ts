/** Decoded internal operation bodies and their result contracts. */
import { Schema } from "effect";
import {
  AttachmentId,
  AttachmentReferences,
  type FileDescriptor,
  FileKind,
  FileMediaType,
  FileName,
  MAX_EXCERPT_CHARS,
  MAX_IMAGE_BYTES,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  MAX_TEXT_FILE_BYTES,
} from "./chat-attachment-schema.ts";
import { DomainUuid } from "./chat-capabilities.ts";
import { SWEEP_BATCH_LIMIT } from "./chat-files-model.ts";

export type ChatFilesReserveResult = {
  readonly status: "reserved" | "existing";
  readonly file: FileDescriptor;
};

export type ChatFilesPrepareResult = {
  readonly files: readonly FileDescriptor[];
  /** Server-side integrity digests in the same order as `files`; never public. */
  readonly digests: readonly string[];
  readonly byteSize: number;
  readonly hasImage: boolean;
};

export type ChatFilesUsageView = {
  readonly retainedBytes: number;
  readonly stagedBytes: number;
  readonly reservedBytes: number;
  /** Uncertain failed uploads and purge-pending tombstones still holding bytes. */
  readonly pendingBytes: number;
  readonly usedBytes: number;
  readonly quotaBytes: number;
};

export type ChatFilesRemoveResult = "removed" | "in_use" | "not_found";

const Now = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));
const Digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const PixelCount = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(100_000),
);
const ByteSize = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(MAX_MESSAGE_ATTACHMENT_BYTES),
);
const Excerpt = Schema.String.check(Schema.isMaxLength(MAX_EXCERPT_CHARS));

/** Metadata must already be internally consistent; the store only records it. */
const consistent = (input: {
  readonly kind: FileKind;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly excerpt: string | null;
}): boolean => {
  const image = input.kind === "image";
  if (input.byteSize > (image ? MAX_IMAGE_BYTES : MAX_TEXT_FILE_BYTES)) return false;
  if (image !== input.mediaType.startsWith("image/")) return false;
  return image
    ? input.width !== null && input.height !== null && input.excerpt === null
    : input.width === null && input.height === null && input.excerpt !== null;
};

export const ChatFilesReserve = Schema.Struct({
  fileId: AttachmentId,
  chatId: DomainUuid,
  kind: FileKind,
  name: FileName,
  mediaType: FileMediaType,
  byteSize: ByteSize,
  digest: Digest,
  width: Schema.NullOr(PixelCount),
  height: Schema.NullOr(PixelCount),
  excerpt: Schema.NullOr(Excerpt),
  now: Now,
}).check(Schema.makeFilter(consistent));
export type ChatFilesReserve = typeof ChatFilesReserve.Type;

export const ChatFilesStaged = Schema.Struct({
  fileId: AttachmentId,
  chatId: DomainUuid,
  now: Now,
});
export type ChatFilesStaged = typeof ChatFilesStaged.Type;

export const ChatFilesAbort = Schema.Struct({
  fileId: AttachmentId,
  chatId: DomainUuid,
  now: Now,
});
export type ChatFilesAbort = typeof ChatFilesAbort.Type;

export const ChatFilesPrepare = Schema.Struct({
  operationId: DomainUuid,
  chatId: DomainUuid,
  fileIds: AttachmentReferences,
  now: Now,
});
export type ChatFilesPrepare = typeof ChatFilesPrepare.Type;

export const ChatFilesCommit = ChatFilesPrepare;
export type ChatFilesCommit = typeof ChatFilesCommit.Type;

export const ChatFilesRelease = Schema.Struct({
  operationId: DomainUuid,
  chatId: DomainUuid,
  now: Now,
});
export type ChatFilesRelease = typeof ChatFilesRelease.Type;

export const ChatFilesRemove = Schema.Struct({
  chatId: DomainUuid,
  fileId: AttachmentId,
  now: Now,
});
export type ChatFilesRemove = typeof ChatFilesRemove.Type;

export const ChatFilesGetQuery = Schema.Struct({
  chatId: DomainUuid,
  fileId: AttachmentId,
});
export type ChatFilesGetQuery = typeof ChatFilesGetQuery.Type;

export const ChatFilesListQuery = Schema.Struct({ chatId: DomainUuid });
export type ChatFilesListQuery = typeof ChatFilesListQuery.Type;

export const ChatFilesSweep = Schema.Struct({
  now: Now,
  limit: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(SWEEP_BATCH_LIMIT),
  ),
});
export type ChatFilesSweep = typeof ChatFilesSweep.Type;
