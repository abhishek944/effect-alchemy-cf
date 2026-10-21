import { Schema } from "effect";
import { ChatSelection } from "./chat-capabilities.ts";

export const MAX_SKILL_BYTES = 64 * 1024;
export const MAX_SKILLS = 32;
export const MAX_SKILL_VERSIONS = 512;
export const MAX_SKILL_INTENTS = 4096;
/** Permanent negative New Send receipts per conversation, not upload intents. */
export const MAX_SKILL_NO_ADMISSIONS = 256;
export const MAX_SKILL_STORAGE_BYTES = 64 * 1024 * 1024;

export const SkillId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);
export const SkillRevision = Schema.Union([Schema.Literal("0"), SkillId]);
export const SkillFilename = Schema.String.check(
  Schema.isMinLength(4),
  Schema.isMaxLength(180),
  Schema.isPattern(/^[^/\\\p{Cc}]+\.(?:txt|md)$/iu),
);
export const SkillDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const ByteSize = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: MAX_SKILL_BYTES }),
);
const Message = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));

export const SkillFile = Schema.Struct({
  id: SkillId,
  filename: SkillFilename,
  version: SkillId,
});
export type SkillFile = typeof SkillFile.Type;

export const SkillVersionRef = Schema.Struct({
  ...SkillFile.fields,
  digest: SkillDigest,
  byteSize: ByteSize,
});
export type SkillVersionRef = typeof SkillVersionRef.Type;

export const SkillManifest = Schema.Struct({
  ownerScope: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  revision: SkillRevision,
  digest: SkillDigest,
  files: Schema.Array(SkillVersionRef).check(Schema.isMaxLength(MAX_SKILLS)),
});
export type SkillManifest = typeof SkillManifest.Type;

export const PublishedSkillUpload = Schema.Struct({
  uploadId: SkillId,
  state: Schema.Literal("published"),
  revision: SkillRevision,
  file: SkillFile,
});
export type PublishedSkillUpload = typeof PublishedSkillUpload.Type;

export const SkillUploadReceipt = Schema.Union([
  PublishedSkillUpload,
  Schema.Struct({ uploadId: SkillId, state: Schema.Literal("pending") }),
  Schema.Struct({ uploadId: SkillId, state: Schema.Literal("missing") }),
  Schema.Struct({ uploadId: SkillId, state: Schema.Literal("expired") }),
]);
export type SkillUploadReceipt = typeof SkillUploadReceipt.Type;

export const SkillList = Schema.Struct({
  revision: SkillRevision,
  files: Schema.Array(SkillFile).check(Schema.isMaxLength(MAX_SKILLS)),
  receipt: Schema.NullOr(SkillUploadReceipt),
});
export type SkillList = typeof SkillList.Type;

export const SkillError = Schema.Struct({
  code: Schema.Literals([
    "invalid_skill",
    "skill_exists",
    "skill_conflict",
    "skill_limit",
    "skills_unavailable",
    "skill_upload_unknown",
  ]),
  message: Message,
  current: Schema.NullOr(SkillFile),
});
export type SkillError = typeof SkillError.Type;

export const SkillReservationRequest = Schema.Struct({
  uploadId: SkillId,
  filename: SkillFilename,
  digest: SkillDigest,
  byteSize: ByteSize,
  replaceVersion: Schema.NullOr(SkillId),
});
export type SkillReservationRequest = typeof SkillReservationRequest.Type;

/** A null revision is reserved, not published or accepted by any conversation. */
export const SkillReservation = Schema.Struct({
  uploadId: SkillId,
  ownerScope: SkillManifest.fields.ownerScope,
  file: SkillVersionRef,
  revision: Schema.NullOr(SkillRevision),
});
export type SkillReservation = typeof SkillReservation.Type;

export const SkillPublishRequest = Schema.Struct({ uploadId: SkillId });
export const SkillCancelRequest = Schema.Struct({ uploadId: SkillId });

/** Native attempt identity is distinct from the original logical user operation. */
export const SkillRecovery = Schema.Struct({
  logicalOperationId: SkillId,
  failedAttemptId: SkillId,
  canRetry: Schema.Boolean,
  message: Message,
});
export type SkillRecovery = typeof SkillRecovery.Type;

export const SkillRetryRequest = Schema.Struct({
  logicalOperationId: SkillId,
  failedAttemptId: SkillId,
  retryKey: SkillId,
});
export type SkillRetryRequest = typeof SkillRetryRequest.Type;

/** Explicit new Send; current model/skills, not a repinned original Retry. */
export const SkillNewSendRequest = Schema.Struct({
  sourceOperationId: SkillId,
  sourceAttemptId: SkillId,
  operationId: SkillId,
  selection: ChatSelection,
});
export type SkillNewSendRequest = typeof SkillNewSendRequest.Type;

export const SkillAttemptAccepted = Schema.Struct({
  accepted: Schema.Literal(true),
  operationId: SkillId,
  logicalOperationId: SkillId,
});
export type SkillAttemptAccepted = typeof SkillAttemptAccepted.Type;

/** Only after a durable fence permanently forbids this New Send UUID. */
export class SkillAttemptNoAdmission extends Schema.TaggedError<SkillAttemptNoAdmission>()(
  "SkillAttemptNoAdmission",
  {
    operationId: SkillId,
    logicalOperationId: SkillId,
    terminal: Schema.Literal(true),
    code: Schema.Literal("skills_not_admitted"),
    message: Message,
  },
  { httpApiStatus: 409 },
) {}
