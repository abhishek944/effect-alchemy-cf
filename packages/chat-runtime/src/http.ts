import { Schema } from "effect";

/** Configuration the Worker and the host both read. */
export const ChatHostUrlEnv = "CHAT_HOST_URL";
export const ChatHostPortEnv = "CHAT_HOST_PORT";
export const ChatHostTokenEnv = "CHAT_HOST_TOKEN";

export const AuthorizationHeader = "authorization";
export const BearerScheme = "Bearer";
export const JsonMediaType = "application/json";
export const NdjsonMediaType = "application/x-ndjson";

const segment = (value: string): string => encodeURIComponent(value);

/** Endpoints served by the run host. */
export const ChatHostPaths = {
  runs: "/runs",
  health: "/health",
  runReply: (runId: string, requestId: string) =>
    `/runs/${segment(runId)}/replies/${segment(requestId)}`,
  runStop: (runId: string) => `/runs/${segment(runId)}/stop`,
} as const;

export const HostErrorCode = Schema.Literals([
  "unauthorized",
  "invalid_request",
  "invalid_reply",
  "run_active",
  "run_unknown",
  "stale_reply",
  "not_found",
  "method_not_allowed",
  "internal",
]);
export type HostErrorCode = typeof HostErrorCode.Type;

/** Every non-success body, so the Worker can branch on `error` alone. */
export const HostError = Schema.Struct({
  error: HostErrorCode,
  message: Schema.optionalKey(Schema.String),
});
export type HostError = typeof HostError.Type;

const statusByCode: Record<HostErrorCode, number> = {
  unauthorized: 401,
  invalid_request: 400,
  invalid_reply: 400,
  run_unknown: 404,
  not_found: 404,
  method_not_allowed: 405,
  run_active: 409,
  stale_reply: 409,
  internal: 500,
};

/** Status code for a refusal, exhaustive over the shared error codes. */
export const httpStatusOf = (code: HostErrorCode): number => statusByCode[code];
