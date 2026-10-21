import { Effect } from "effect";
import {
  OfficeConflict,
  OfficeForbidden,
  OfficeInvalid,
  OfficeLimited,
  OfficeNotFound,
  OfficeUnavailable,
  OfficeUnauthorized,
  safeFailure,
  type ErrorCode,
  type OfficeError,
} from "@starter/office-contract";
import { CollabError } from "@univerjs-pro/collaboration-service";
import { WorktreeError } from "@univerjs-pro/collaboration-worktree-service";

export function officeFailure(code: ErrorCode, operationId: string | null = null): OfficeError {
  const value = safeFailure(code, operationId);
  if (code === "UNAUTHENTICATED") return new OfficeUnauthorized(value);
  if (code === "FORBIDDEN") return new OfficeForbidden(value);
  if (code === "NOT_FOUND" || code === "CONTENT_REQUIRED") return new OfficeNotFound(value);
  if (code === "INVALID_INPUT") return new OfficeInvalid(value);
  if (code === "LIMIT_EXCEEDED") return new OfficeLimited(value);
  if (
    [
      "UNAVAILABLE",
      "BUSY",
      "EXECUTOR_UNCONFIGURED",
      "OUTCOME_UNKNOWN",
      "HISTORY_INCOMPLETE",
    ].includes(code)
  )
    return new OfficeUnavailable(value);
  return new OfficeConflict(value);
}
export const isOfficeError = (value: unknown): value is OfficeError =>
  value instanceof OfficeConflict ||
  value instanceof OfficeForbidden ||
  value instanceof OfficeInvalid ||
  value instanceof OfficeLimited ||
  value instanceof OfficeNotFound ||
  value instanceof OfficeUnavailable ||
  value instanceof OfficeUnauthorized;
export function nativeFailure(cause: unknown): OfficeError {
  if (isOfficeError(cause)) return cause;
  if (cause instanceof CollabError) {
    if (cause.code === "UNAUTHENTICATED") return officeFailure("UNAUTHENTICATED");
    if (cause.code === "PERMISSION_DENIED") return officeFailure("FORBIDDEN");
    if (cause.code === "UNIT_NOT_FOUND") return officeFailure("NOT_FOUND");
    if (cause.code === "INVALID_REQUEST") return officeFailure("INVALID_INPUT");
    if (cause.code === "OT_CONFLICT") return officeFailure("NATIVE_CONFLICT");
    if (cause.code === "REVISION_MISMATCH") return officeFailure("STALE_BASIS");
  }
  if (cause instanceof WorktreeError) {
    if (cause.code === "WORKTREE_NOT_FOUND" || cause.code === "WORKTREE_UNIT_NOT_FOUND")
      return officeFailure("NOT_FOUND");
    return officeFailure("NOT_EDITABLE");
  }
  return officeFailure("UNAVAILABLE");
}
export const nativeCall = <A>(call: () => Promise<A>) =>
  Effect.tryPromise({
    try: call,
    catch: nativeFailure,
  });
