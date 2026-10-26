import { Schema } from "effect";
import { Id } from "./primitives.ts";

export const ErrorCode = Schema.Literals([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_INPUT",
  "IDEMPOTENCY_CONFLICT",
  "BUSY",
  "NOT_EDITABLE",
  "STALE_BASIS",
  "STALE_REVIEW",
  "NATIVE_CONFLICT",
  "LIMIT_EXCEEDED",
  "CONTENT_REQUIRED",
  "UNAVAILABLE",
  "EXECUTOR_UNCONFIGURED",
  "OUTCOME_UNKNOWN",
  "HISTORY_INCOMPLETE",
  "AUTHORITY_LOST",
]);
export type ErrorCode = typeof ErrorCode.Type;
export const Failure = Schema.Struct({
  code: ErrorCode,
  message: Schema.String.check(Schema.isMaxLength(512)),
  operationId: Schema.NullOr(Id),
});
export type Failure = typeof Failure.Type;
const fields = {
  code: ErrorCode,
  message: Schema.String.check(Schema.isMaxLength(512)),
  operationId: Schema.NullOr(Id),
};
export class OfficeInvalid extends Schema.TaggedError<OfficeInvalid>()("OfficeInvalid", fields, {
  httpApiStatus: 400,
}) {}
export class OfficeUnauthorized extends Schema.TaggedError<OfficeUnauthorized>()(
  "OfficeUnauthorized",
  fields,
  { httpApiStatus: 401 },
) {}
export class OfficeForbidden extends Schema.TaggedError<OfficeForbidden>()(
  "OfficeForbidden",
  fields,
  { httpApiStatus: 403 },
) {}
export class OfficeNotFound extends Schema.TaggedError<OfficeNotFound>()("OfficeNotFound", fields, {
  httpApiStatus: 404,
}) {}
export class OfficeConflict extends Schema.TaggedError<OfficeConflict>()("OfficeConflict", fields, {
  httpApiStatus: 409,
}) {}
export class OfficeLimited extends Schema.TaggedError<OfficeLimited>()("OfficeLimited", fields, {
  httpApiStatus: 413,
}) {}
export class OfficeUnavailable extends Schema.TaggedError<OfficeUnavailable>()(
  "OfficeUnavailable",
  fields,
  { httpApiStatus: 503 },
) {}
export const OfficeErrors = [
  OfficeInvalid,
  OfficeUnauthorized,
  OfficeForbidden,
  OfficeNotFound,
  OfficeConflict,
  OfficeLimited,
  OfficeUnavailable,
] as const;
export type OfficeError = InstanceType<(typeof OfficeErrors)[number]>;
/** Do not pass foreign error messages/stacks through this helper. */
export const safeFailure = (code: ErrorCode, operationId: string | null = null): Failure => ({
  code,
  operationId,
  message:
    code === "OUTCOME_UNKNOWN" || code === "HISTORY_INCOMPLETE"
      ? "The original outcome is unconfirmed. Check its operation status; do not repeat the write."
      : code === "STALE_BASIS"
        ? "The draft changed; the staged proposal was not applied."
        : "The Office request could not be completed.",
});
