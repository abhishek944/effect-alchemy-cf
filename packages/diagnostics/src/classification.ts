import { diagnosticReason, label } from "./context.ts";
import { diagnosticFrames } from "./frames.ts";
import { PROVIDER_CODES } from "./provider-codes.ts";
export { DIAGNOSTIC_FRAME_PATTERN } from "./frames.ts";
// Only these classifications may leave memory. Never stringify a foreign error.
export const DIAGNOSTIC_TYPES = [
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AbortError",
  "TimeoutError",
  "AggregateError",
  "SchemaError",
  "ConfigError",
  "Interrupted",
  "OfficeInvalid",
  "OfficeUnauthorized",
  "OfficeForbidden",
  "OfficeNotFound",
  "OfficeConflict",
  "OfficeLimited",
  "OfficeUnavailable",
  "OfficeSessionDenied",
  "OfficeSessionUnavailable",
  "IntegrationError",
  "BillingError",
  "SpeechTransportError",
  "ImageIOError",
  "ImageHydrationError",
  "OfficeStagingFailure",
  "SkillObjectUnavailable",
  "CollabError",
  "WorktreeError",
  "AuthenticationUnavailable",
  "Unauthorized",
  "ChatInvalid",
  "ChatUnavailable",
  "ChatForbidden",
  "ChatNotFound",
  "ChatBusy",
  "APIError",
  "APIConnectionError",
] as const;
export const DIAGNOSTIC_CODES = [
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
  "PERMISSION_DENIED",
  "UNIT_NOT_FOUND",
  "INVALID_REQUEST",
  "OT_CONFLICT",
  "REVISION_MISMATCH",
  "WORKTREE_NOT_FOUND",
  "WORKTREE_UNIT_NOT_FOUND",
  "InvalidConfiguration",
  "InvalidInput",
  "Transport",
  "Timeout",
  "Http",
  "InvalidResponse",
  "Rejected",
  "Configuration",
  "Signature",
  "Provider",
  "Storage",
  "Busy",
  "Unmapped",
  "NotFound",
  "Conflict",
  "UnknownOutcome",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ABORT_ERR",
  "SQLITE_BUSY",
  "SQLITE_CONSTRAINT",
  "SQLITE_CANTOPEN",
  "SQLITE_CORRUPT",
  "SQLITE_ERROR",
  "timeout",
  "network",
  "upstream_rejected",
  "invalid_response",
  "cancelled",
  "io_failed",
  "invalid_body",
  "body_too_large",
  "aborted",
  "invalid_metadata",
  "original_unavailable",
  "original_integrity",
  "stream_limit",
  "output_url_refused",
  "invalid_context",
  "metadata_mismatch",
  "model_mismatch",
  "model_image_unsupported",
  "model_image_limits",
  "quoted_text_too_large",
  "text_budget",
  "context_budget",
  "read_failed",
  ...PROVIDER_CODES,
] as const;
const tags = new Set<string>(DIAGNOSTIC_TYPES);
const codes = new Set<string>([...DIAGNOSTIC_CODES, ...PROVIDER_CODES]);

/** Read data properties only. Foreign getters/toJSON/inspection hooks never run. */
export const own = (value: object, key: string): unknown =>
  Object.getOwnPropertyDescriptor(value, key)?.value;

export function classification(value: object) {
  const tag = own(value, "_tag") ?? own(value, "name");
  const type =
    typeof tag === "string" && tags.has(tag)
      ? tag
      : value instanceof AggregateError
        ? "AggregateError"
        : value instanceof TypeError
          ? "TypeError"
          : value instanceof RangeError
            ? "RangeError"
            : value instanceof SyntaxError
              ? "SyntaxError"
              : value instanceof Error
                ? "Error"
                : "Unclassified";
  const explicitCode = own(value, "code");
  const kind = own(value, "kind");
  const code = typeof explicitCode === "string" && codes.has(explicitCode) ? explicitCode : kind;
  const provider = own(value, "provider");
  const retry = own(value, "retryAfterSeconds");
  const reason: unknown = Object.getOwnPropertyDescriptor(value, diagnosticReason)?.value;
  const status = own(value, "status") ?? own(value, "statusCode");
  const frames = diagnosticFrames(own(value, "stack"));
  return {
    type,
    ...(typeof code === "string" && codes.has(code) ? { code } : {}),
    ...(typeof kind === "string" && codes.has(kind) ? { kind } : {}),
    ...(typeof provider === "string" &&
    ["cloudflare", "resend", "slack", "dodo", "polar"].includes(provider)
      ? { provider }
      : {}),
    ...(typeof retry === "number" && Number.isSafeInteger(retry) && retry >= 0 && retry <= 86400
      ? { retry_after_seconds: retry }
      : {}),
    ...(typeof reason === "string" ? { reason: label(reason) } : {}),
    ...(typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
      ? { status }
      : {}),
    ...(frames.length > 0 ? { frames } : {}),
  };
}
