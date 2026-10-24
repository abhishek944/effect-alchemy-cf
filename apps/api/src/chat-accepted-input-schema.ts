import { Schema } from "effect";
import type { OfficeSendTarget } from "@starter/office-contract";
import {
  FileMediaType,
  FileName,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_OFFICE_BYTES,
  MAX_TEXT_FILE_BYTES,
} from "./chat-attachment-schema.ts";
import { DomainUuid } from "./chat-capabilities.ts";
import { isOfficeMediaType } from "./chat-office-media.ts";

/**
 * Persisted accepted-input records predate this module. These schemas are moved here
 * unchanged (same fields, checks and encoded values) so image and Office capabilities share
 * one accepted-input representation without rewriting stored rows.
 */
export const AcceptedInputDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
export type AcceptedInputDigest = typeof AcceptedInputDigest.Type;
/** Application/native identifiers are not SDK brands and need not be UUIDs. */
export const AcceptedInputIdentity = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.makeFilter((value) =>
    Array.from(value).every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    }),
  ),
);
export const AcceptedInputIndex = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
);
const Positive = AcceptedInputIndex.check(Schema.isGreaterThan(0));
const LogicalUrl = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "" &&
        url.href === value
      );
    } catch {
      return false;
    }
  }),
);

export const AcceptedOriginalBinding = Schema.Struct({
  fileId: DomainUuid,
  digest: AcceptedInputDigest,
  url: LogicalUrl,
  originOperationId: Schema.NullOr(DomainUuid),
  kind: Schema.Literals(["image", "text", "office"]),
  name: FileName,
  byteSize: Positive,
  mediaType: FileMediaType,
  width: Schema.NullOr(Positive),
  height: Schema.NullOr(Positive),
}).check(
  Schema.makeFilter((file) => {
    if (file.kind === "text")
      return (
        !file.mediaType.startsWith("image/") &&
        !isOfficeMediaType(file.mediaType) &&
        file.byteSize <= MAX_TEXT_FILE_BYTES &&
        file.width === null &&
        file.height === null
      );
    if (file.kind === "office")
      return (
        isOfficeMediaType(file.mediaType) &&
        file.byteSize <= MAX_OFFICE_BYTES &&
        file.width === null &&
        file.height === null
      );
    return (
      file.mediaType.startsWith("image/") &&
      file.byteSize <= MAX_IMAGE_BYTES &&
      file.width !== null &&
      file.height !== null &&
      file.width * file.height <= MAX_IMAGE_PIXELS
    );
  }),
);
export type AcceptedOriginalBinding = typeof AcceptedOriginalBinding.Type;

/** Exact placed native input this accepted operation was bound to. */
export const AcceptedInputBinding = Schema.Struct({
  operationId: DomainUuid,
  submissionId: AcceptedInputIdentity,
  conversationId: AcceptedInputIdentity,
  entryId: Positive,
  modelIndex: AcceptedInputIndex,
  inputDigest: AcceptedInputDigest,
});
export type AcceptedInputBinding = typeof AcceptedInputBinding.Type;

/** Neutral subset of the persisted accepted-input record. Image capability stays optional. */
export type AcceptedInputRecord = {
  readonly operationId: DomainUuid;
  readonly identityHash: AcceptedInputDigest;
  readonly ownerId: string;
  readonly chatId: DomainUuid;
  readonly chatScope: string;
  readonly conversationId: string;
  readonly inputDigest: AcceptedInputDigest;
  readonly originals: readonly AcceptedOriginalBinding[];
  readonly officeTarget?: OfficeSendTarget | undefined;
};

export type BoundAcceptedInput<Record extends AcceptedInputRecord = AcceptedInputRecord> = {
  readonly candidate: Record;
  readonly binding: AcceptedInputBinding;
};
