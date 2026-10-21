import { Schema } from "effect";
import {
  OfficeErrors,
  OfficeUnauthorized,
  OfficeForbidden,
  OfficeInvalid,
  OfficeNotFound,
  OfficeConflict,
  OfficeLimited,
  OfficeUnavailable,
  safeFailure,
  type Failure,
  type OfficeError,
} from "@starter/office-contract";

export const isOfficeChannelError = Schema.is(Schema.Union(OfficeErrors));
/** Retain finite domain codes, never foreign messages, stack traces or an unsafe retry hint. */
export function officeChannelError(input: Failure): OfficeError {
  const value = safeFailure(input.code, input.operationId);
  switch (input.code) {
    case "UNAUTHENTICATED":
      return new OfficeUnauthorized(value);
    case "FORBIDDEN":
      return new OfficeForbidden(value);
    case "INVALID_INPUT":
      return new OfficeInvalid(value);
    case "NOT_FOUND":
      return new OfficeNotFound(value);
    case "LIMIT_EXCEEDED":
      return new OfficeLimited(value);
    case "UNAVAILABLE":
    case "EXECUTOR_UNCONFIGURED":
    case "OUTCOME_UNKNOWN":
    case "HISTORY_INCOMPLETE":
      return new OfficeUnavailable(value);
    default:
      return new OfficeConflict(value);
  }
}
