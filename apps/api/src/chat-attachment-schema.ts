/**
 * Private attachment references and their public metadata.
 *
 * The public descriptor carries identity and safe display metadata only. It
 * never contains a storage object key, a public URL, base64 bytes, provider
 * credentials or owner identity: owner scope stays server-side and `chatId`
 * is the only cross-reference a browser needs. Binary validation and the
 * exact filename-to-media allowlist are the file implementation's duty: this
 * module bounds the declared metadata, but a declared MIME type is not proof
 * of content, so T21 must still verify magic bytes, UTF-8 validity, decoded
 * dimensions/pixels and the name extension before acceptance.
 */
import { Schema } from "effect";
import { DomainUuid, IsoTimestamp } from "./chat-capabilities.ts";
import { isOfficeMediaType, OFFICE_MEDIA_PATTERN } from "./chat-office-media.ts";

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_IMAGE_BYTES = 10_485_760;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_TEXT_FILE_BYTES = 1_048_576;
export const MAX_OFFICE_BYTES = 10_485_760;
export const MAX_MESSAGE_ATTACHMENT_BYTES = 20_971_520;
export const MAX_QUOTED_TEXT_CHARS = 100_000;
export const MAX_EXCERPT_CHARS = 2_000;
export const RETAINED_BYTES_PER_USER = 1_073_741_824;
export const ABANDONED_UPLOAD_TTL_MS = 86_400_000;
export const LOCAL_DRAFT_BYTES_PER_TAB = 41_943_040;
export const PREVIEW_CACHE_BYTES = 20_971_520;
export const PREVIEW_DECODED_BYTES = 67_108_864;

const ByteCount = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0),
);
const Pixel = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0),
);
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

export const FILE_KINDS = ["image", "text", "office"] as const;
export const FileKind = Schema.Literals(FILE_KINDS);
export type FileKind = typeof FileKind.Type;

export const FILE_STATES = ["uploading", "ready", "failed", "expired", "unavailable"] as const;
export const FileState = Schema.Literals(FILE_STATES);
export type FileState = typeof FileState.Type;

/** Allowlisted image, UTF-8 text/JSON and the three supported Office containers. */
export const FileMediaType = Schema.String.check(
  Schema.isPattern(
    new RegExp(
      `^(image\\/(jpeg|png|webp)|${OFFICE_MEDIA_PATTERN}|application\\/json|text\\/[a-z0-9][a-z0-9.+-]{0,63})$`,
    ),
  ),
);
export type FileMediaType = typeof FileMediaType.Type;

const safeName = (value: string): boolean => {
  if (value.includes("/") || value.includes("\\")) return false;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
};

export const FileName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.makeFilter(safeName),
);
export type FileName = typeof FileName.Type;

export const AttachmentId = DomainUuid;
export type AttachmentId = typeof AttachmentId.Type;

/** Unique submitted references; a duplicate id would be double-counted by quota. */
export const AttachmentReferences = Schema.Array(AttachmentId).check(
  Schema.isMaxLength(MAX_ATTACHMENTS_PER_MESSAGE),
  Schema.makeFilter(unique),
);
export type AttachmentReferences = typeof AttachmentReferences.Type;

const maxBytesFor = (kind: FileKind): number =>
  kind === "image" ? MAX_IMAGE_BYTES : kind === "office" ? MAX_OFFICE_BYTES : MAX_TEXT_FILE_BYTES;

/** Safe display metadata for one owner- and chat-scoped original. */
export const FileDescriptor = Schema.Struct({
  id: AttachmentId,
  chatId: DomainUuid,
  kind: FileKind,
  name: FileName,
  mediaType: FileMediaType,
  byteSize: ByteCount,
  state: FileState,
  width: Schema.NullOr(Pixel),
  height: Schema.NullOr(Pixel),
  excerpt: Schema.NullOr(Schema.String.check(Schema.isMaxLength(MAX_EXCERPT_CHARS))),
  createdAt: IsoTimestamp,
  /** Set only for an uncommitted upload that cleanup may abandon. */
  expiresAt: Schema.NullOr(IsoTimestamp),
}).check(
  Schema.makeFilter((file) => {
    if (file.byteSize > maxBytesFor(file.kind)) return false;
    if ((file.kind === "image") !== file.mediaType.startsWith("image/")) return false;
    if (file.kind === "office" && !isOfficeMediaType(file.mediaType)) return false;
    if (file.kind !== "office" && isOfficeMediaType(file.mediaType)) return false;
    if (file.width !== null && file.height !== null && file.width * file.height > MAX_IMAGE_PIXELS)
      return false;
    if (file.state !== "ready") return true;
    if (file.kind === "image")
      return file.width !== null && file.height !== null && file.excerpt === null;
    if (file.kind === "office")
      return file.width === null && file.height === null && file.excerpt === null;
    return file.excerpt !== null && file.width === null && file.height === null;
  }),
);
export type FileDescriptor = typeof FileDescriptor.Type;

export const FileDescriptorList = Schema.Struct({
  chatId: DomainUuid,
  files: Schema.Array(FileDescriptor)
    .check(Schema.isMaxLength(MAX_ATTACHMENTS_PER_MESSAGE))
    .check(Schema.makeFilter((files) => unique(files.map((file) => file.id)))),
}).check(Schema.makeFilter((list) => list.files.every((file) => file.chatId === list.chatId)));
export type FileDescriptorList = typeof FileDescriptorList.Type;
