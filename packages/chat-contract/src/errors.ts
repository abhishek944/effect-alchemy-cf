import { Schema } from "effect";

/**
 * The one typed failure contract shared by the API and the browser.
 *
 * Every tag below is a server-owned `Schema.TaggedError` with an `httpApiStatus`.
 * The client mirrors the tags and their copy; it never invents a status-only
 * message, so a signed-out, denied, conflict and outage state stay distinct.
 */
export const API_ERROR_TAGS = [
  "Unauthorized",
  "AuthenticationUnavailable",
  "Forbidden",
  "UserNotFound",
  "ChatNotFound",
  "ChatForbidden",
  "ChatInvalid",
  "ChatBusy",
  "ChatArchived",
  "ChatRateLimited",
  "ChatUnavailable",
  "InferenceUnavailable",
  "SubmissionFailed",
  "PayloadTooLarge",
  "RefreshRequired",
  "ChatPreferenceConflict",
  "SkillAttemptNoAdmission",
] as const;
export type ApiErrorTag = (typeof API_ERROR_TAGS)[number];

export const ApiErrorBody = Schema.Struct({
  _tag: Schema.Literals(API_ERROR_TAGS),
  message: Schema.optionalKey(Schema.String),
});
export type ApiErrorBody = typeof ApiErrorBody.Type;

const STATUS: Readonly<Record<ApiErrorTag, number>> = {
  Unauthorized: 401,
  AuthenticationUnavailable: 503,
  Forbidden: 403,
  UserNotFound: 404,
  ChatNotFound: 404,
  ChatForbidden: 403,
  ChatInvalid: 400,
  ChatBusy: 409,
  ChatArchived: 409,
  ChatRateLimited: 429,
  ChatUnavailable: 503,
  InferenceUnavailable: 503,
  SubmissionFailed: 503,
  PayloadTooLarge: 413,
  RefreshRequired: 409,
  ChatPreferenceConflict: 409,
  SkillAttemptNoAdmission: 409,
};

export const statusOfTag = (tag: ApiErrorTag): number => STATUS[tag];

/** Decode a response body into the typed failure, or null when it is not one. */
export const readApiErrorBody = (body: unknown): ApiErrorBody | null => {
  try {
    return Schema.decodeUnknownSync(ApiErrorBody)(body);
  } catch {
    return null;
  }
};
