import { Option, Schema } from "effect";
import { DomainUuid } from "./chat-capabilities.ts";
import { MAX_IMAGE_BYTES, RETAINED_BYTES_PER_USER } from "./chat-attachment-schema.ts";

export const ImageCallId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.makeFilter((value) =>
    Array.from(value).every((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    }),
  ),
);
export const ImageDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
export const ImageIndex = Schema.Number.check(
  Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= 0),
);
export const ImagePositive = Schema.Number.check(
  Schema.makeFilter((n) => Number.isSafeInteger(n) && n > 0),
);
export const ImageCallKey = Schema.Struct({ chatId: DomainUuid, callId: ImageCallId });
export type ImageCallKey = typeof ImageCallKey.Type;
export const ImageSources = Schema.Array(DomainUuid);
/** Safe once-per-call snapshot. Full canonical request identity is its actual SHA-256. */
export const ImageReservation = Schema.Struct({
  ...ImageCallKey.fields,
  operationId: DomainUuid,
  requestDigest: ImageDigest,
  maxOutputBytes: ImagePositive.check(Schema.isLessThanOrEqualTo(RETAINED_BYTES_PER_USER)),
  sources: ImageSources,
  model: Schema.Literals(["flare", "sunburst"]),
  size: Schema.Literals(["auto", "1024x1024", "1024x1536", "1536x1024"]),
  quality: Schema.Literals(["auto", "low", "medium", "high", "xhigh", "max"]),
});
export type ImageReservation = typeof ImageReservation.Type;
export const ImageOutputKey = Schema.Struct({ ...ImageCallKey.fields, index: ImageIndex });
export type ImageOutputKey = typeof ImageOutputKey.Type;
/** Private write-ack repair identity; never part of a browser SavedFile. */
export const ImageReceiptExpectation = Schema.Struct({
  digest: ImageDigest,
  total: ImagePositive,
  byteSize: ImagePositive.check(Schema.isLessThanOrEqualTo(MAX_IMAGE_BYTES)),
  mediaType: Schema.Literals(["image/jpeg", "image/png", "image/webp"]),
});
export type ImageReceiptExpectation = typeof ImageReceiptExpectation.Type;
export const ImageStoreQuery = Schema.Struct({
  ...ImageOutputKey.fields,
  total: ImagePositive,
});
export type ImageStoreQuery = typeof ImageStoreQuery.Type;
export const ImageStorageFailureCode = Schema.Literals([
  "invalid_input",
  "not_found",
  "conflict",
  "quota_exceeded",
  "not_admitted",
  "archived",
  "unavailable",
  "unresolved",
  "invalid_output",
]);
export type ImageStorageFailureCode = typeof ImageStorageFailureCode.Type;
export class ImageStorageError extends Error {
  readonly code: ImageStorageFailureCode;
  constructor(code: ImageStorageFailureCode) {
    super(`Image storage: ${code}`);
    this.name = "ImageStorageError";
    this.code = code;
  }
}
export const requireImageValue = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  raw: unknown,
): S["Type"] => {
  const value = Option.getOrNull(Schema.decodeUnknownOption(schema)(raw));
  if (value === null) throw new ImageStorageError("invalid_input");
  return value;
};
