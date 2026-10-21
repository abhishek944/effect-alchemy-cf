import type { CatalogImageModelId } from "@abhishek944/pi-image-gen/core";
import { Schema } from "effect";
import { OfficeSendTarget } from "@starter/office-contract";
import {
  FileMediaType,
  FileName,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_TEXT_FILE_BYTES,
  MAX_OFFICE_BYTES,
} from "./chat-attachment-schema.ts";
import { isOfficeMediaType } from "./chat-office-media.ts";
import { DomainUuid } from "./chat-capabilities.ts";
import { ImagePreferences } from "./chat-image-preference-schema.ts";
import { isBoundedImageResponseJson } from "./chat-image-response-json.ts";

export const ImageResponseDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
/** Application/native identifiers are not SDK brands and need not be UUIDs. */
export const ImageResponseIdentity = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.makeFilter((value) =>
    Array.from(value).every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    }),
  ),
);
export const ImageResponseIndex = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
);
const Positive = ImageResponseIndex.check(Schema.isGreaterThan(0));
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

export const ImageOriginalBinding = Schema.Struct({
  fileId: DomainUuid,
  digest: ImageResponseDigest,
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
export type ImageOriginalBinding = typeof ImageOriginalBinding.Type;

const models = [
  "openai/gpt-image-2.5-flare",
  "openai/gpt-image-2.5-sunburst",
] as const satisfies readonly CatalogImageModelId[];
/** Image capability outage never removes ordinary request/original lineage. */
export const ImageResponseCapability = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("ready"),
    preferences: ImagePreferences,
    model: Schema.Literals(models),
    gatewayId: ImageResponseIdentity.check(Schema.isTrimmed(), Schema.isMaxLength(128)),
  }).check(
    Schema.makeFilter((image) => image.model === `openai/gpt-image-2.5-${image.preferences.model}`),
  ),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literals(["preferences_unavailable", "configuration_unavailable"]),
  }),
]);
export type ImageResponseCapability = typeof ImageResponseCapability.Type;

export const ImageApplicationOrigin = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(2048),
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
    } catch {
      return false;
    }
  }),
);

export const ImageResponseCandidate = Schema.Struct({
  version: Schema.Literal(1),
  operationId: DomainUuid,
  logicalOperationId: DomainUuid,
  identityHash: ImageResponseDigest,
  ownerId: ImageResponseIdentity,
  chatId: DomainUuid,
  chatScope: ImageResponseIdentity,
  conversationId: ImageResponseIdentity,
  applicationOrigin: ImageApplicationOrigin,
  image: ImageResponseCapability,
  inputDigest: ImageResponseDigest,
  originals: Schema.Array(ImageOriginalBinding),
  officeTarget: Schema.optionalKey(OfficeSendTarget),
}).check(
  Schema.makeFilter(isBoundedImageResponseJson),
  Schema.makeFilter((candidate) =>
    candidate.originals.every(
      (file) =>
        new URL(file.url).pathname === `/api/chats/${candidate.chatId}/attachments/${file.fileId}`,
    ),
  ),
);
export type ImageResponseCandidate = typeof ImageResponseCandidate.Type;

export const ImageAcceptedBinding = Schema.Struct({
  operationId: DomainUuid,
  submissionId: ImageResponseIdentity,
  conversationId: ImageResponseIdentity,
  entryId: Positive,
  modelIndex: ImageResponseIndex,
  inputDigest: ImageResponseDigest,
});
export type ImageAcceptedBinding = typeof ImageAcceptedBinding.Type;

export const ImageBoundInput = Schema.Struct({
  candidate: ImageResponseCandidate,
  binding: ImageAcceptedBinding,
}).check(
  Schema.makeFilter(
    ({ candidate, binding }) =>
      candidate.operationId === binding.operationId &&
      candidate.conversationId === binding.conversationId &&
      candidate.inputDigest === binding.inputDigest,
  ),
);
export type ImageBoundInput = typeof ImageBoundInput.Type;
