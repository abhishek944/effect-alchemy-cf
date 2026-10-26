import type { CatalogImageModelId } from "@abhishek944/pi-image-gen/core";
import { Schema } from "effect";
import { ChatReferenceInputs, OfficeSendTarget } from "@starter/office-contract";
import {
  AcceptedInputBinding,
  AcceptedInputDigest,
  AcceptedInputIdentity,
  AcceptedOriginalBinding,
} from "./chat-accepted-input-schema.ts";
import { DomainUuid } from "./chat-capabilities.ts";
import { ImagePreferences } from "./chat-image-preference-schema.ts";
import { isBoundedImageResponseJson } from "./chat-image-response-json.ts";

/** Persisted image records reuse the neutral accepted-input identities and schemas unchanged. */
export {
  AcceptedInputBinding as ImageAcceptedBinding,
  AcceptedInputDigest as ImageResponseDigest,
  AcceptedInputIdentity as ImageResponseIdentity,
  AcceptedInputIndex as ImageResponseIndex,
  AcceptedOriginalBinding as ImageOriginalBinding,
} from "./chat-accepted-input-schema.ts";
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
    gatewayId: AcceptedInputIdentity.check(Schema.isTrimmed(), Schema.isMaxLength(128)),
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
  identityHash: AcceptedInputDigest,
  ownerId: AcceptedInputIdentity,
  chatId: DomainUuid,
  chatScope: AcceptedInputIdentity,
  conversationId: AcceptedInputIdentity,
  applicationOrigin: ImageApplicationOrigin,
  image: ImageResponseCapability,
  inputDigest: AcceptedInputDigest,
  originals: Schema.Array(AcceptedOriginalBinding),
  officeTarget: Schema.optionalKey(OfficeSendTarget),
  referenceInputs: Schema.optionalKey(ChatReferenceInputs),
}).check(
  Schema.makeFilter(isBoundedImageResponseJson),
  Schema.makeFilter((candidate) =>
    (candidate.referenceInputs ?? []).every(
      (ref) =>
        ref.kind === "native" ||
        candidate.originals.some(
          (file) => file.fileId === ref.fileId && (ref.text === undefined || file.kind === "text"),
        ),
    ),
  ),
  Schema.makeFilter((candidate) =>
    candidate.originals.every(
      (file) =>
        new URL(file.url).pathname === `/api/chats/${candidate.chatId}/attachments/${file.fileId}`,
    ),
  ),
);
export type ImageResponseCandidate = typeof ImageResponseCandidate.Type;

export const ImageBoundInput = Schema.Struct({
  candidate: ImageResponseCandidate,
  binding: AcceptedInputBinding,
}).check(
  Schema.makeFilter(
    ({ candidate, binding }) =>
      candidate.operationId === binding.operationId &&
      candidate.conversationId === binding.conversationId &&
      candidate.inputDigest === binding.inputDigest,
  ),
);
export type ImageBoundInput = typeof ImageBoundInput.Type;
