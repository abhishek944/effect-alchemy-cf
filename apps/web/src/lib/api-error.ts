import { type ApiErrorTag, readApiErrorBody, statusOfTag } from "@highchat/chat-contract";
import { readResponseRequestId, serverReference } from "@/lib/browser-diagnostics";

/**
 * The one client failure type. It carries the server's tag, the HTTP status the
 * server chose for that tag, and the request id used in a support reference.
 */
export class ApiError extends Error {
  readonly tag: ApiErrorTag | null;
  readonly status: number;
  readonly requestId: string | null;
  readonly reference: string;

  constructor(input: {
    tag: ApiErrorTag | null;
    status: number;
    message: string;
    requestId?: string | null;
    operation: string;
    responseStatus?: number;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.tag = input.tag;
    this.status = input.status;
    this.requestId = input.requestId ?? null;
    this.reference = serverReference(
      input.operation,
      input.responseStatus ?? input.status,
      input.requestId ?? null,
    );
  }
}

/** Safe copy per server tag; no entry names a field, an account or a provider. */
const TAG_COPY: Readonly<Record<ApiErrorTag, string>> = {
  Unauthorized: "You are signed out. Sign in again to continue.",
  AuthenticationUnavailable: "Sign-in is temporarily unavailable. Try again shortly.",
  Forbidden: "This action is not allowed for your account.",
  UserNotFound: "That account could not be found.",
  ChatNotFound: "This chat is no longer available.",
  ChatForbidden: "This request was blocked. Reload the page and try again.",
  ChatInvalid: "That request was not valid. Check the details and try again.",
  ChatBusy: "This chat is already handling another request. Wait for it to finish.",
  ChatArchived: "This chat is archived. Unarchive it to continue.",
  ChatRateLimited: "Too many requests. Wait a moment and try again.",
  ChatUnavailable: "The assistant is temporarily unavailable. Try again shortly.",
  InferenceUnavailable: "The model request failed. Check the stage configuration, then retry.",
  SubmissionFailed: "The request could not be submitted. Try again shortly.",
  PayloadTooLarge: "That file or message is too large.",
  RefreshRequired: "Reload the page before trying that again.",
  ChatPreferenceConflict: "Your saved preferences changed elsewhere. Reload and try again.",
  SkillAttemptNoAdmission: "That skill attempt cannot be admitted. Start a new message.",
};

const STATUS_FALLBACK: Readonly<Record<number, string>> = {
  400: "That request was not valid. Check the message and try again.",
  401: "You are signed out. Sign in again to continue.",
  403: "This request was blocked. Reload the page and try again.",
  404: "That record is no longer available.",
  409: "The server cannot accept that change right now.",
  413: "That file or message is too large.",
  429: "Too many requests. Wait a moment and try again.",
  502: "The server returned an unexpected response. Try again.",
  503: "The server is temporarily unavailable. Try again shortly.",
};

const UNEXPECTED = "Something went wrong. Please try again.";

export const apiErrorMessage = (tag: ApiErrorTag | null, status: number): string =>
  tag === null ? (STATUS_FALLBACK[status] ?? UNEXPECTED) : TAG_COPY[tag];

/**
 * Builds the typed failure from a non-OK response. A body tag is authoritative:
 * the status is derived from it so a mismatched proxy status cannot mislead the
 * UI about what actually happened.
 */
export const apiErrorFromResponse = async (
  response: Response,
  operation: string,
): Promise<ApiError> => {
  const requestId = readResponseRequestId(response);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const typed = readApiErrorBody(body);
  const tag = typed?._tag ?? null;
  const status = tag === null ? response.status : statusOfTag(tag);
  return new ApiError({
    tag,
    status,
    message: apiErrorMessage(tag, status),
    requestId,
    operation,
    responseStatus: response.status,
  });
};

export const apiError = (operation: string, status: number): ApiError =>
  new ApiError({ tag: null, status, message: apiErrorMessage(null, status), operation });

/** A network failure has no HTTP status; keep it distinct from a server error. */
export const networkError = (operation: string): ApiError =>
  new ApiError({
    tag: null,
    status: 0,
    message: "Could not reach the server. Check your connection and try again.",
    operation,
  });

export const errorMessageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : UNEXPECTED;
