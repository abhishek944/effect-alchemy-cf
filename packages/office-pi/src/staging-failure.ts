import { Schema } from "effect";
import { withCause } from "@starter/diagnostics";
import { ErrorCode, Id, OfficeErrors, safeFailure } from "@starter/office-contract";

const Stage = Schema.Literals([
  "stage-admission",
  "accepted-proof",
  "accepted-catalog",
  "accepted-storage",
  "accepted-revalidation",
  "stage-metadata",
  "upload-validation",
  "upload-transport",
  "upload-response",
  "upload-acknowledgement",
  "upload-cleanup",
  "upload-observation",
]);
export type OfficeStagingPhase = typeof Stage.Type;
/** Fixed diagnostic labels only. Never copy foreign messages, stacks or request bodies. */
export class OfficeStagingFailure extends Schema.TaggedError<OfficeStagingFailure>()(
  "OfficeStagingFailure",
  {
    operationId: Id,
    stage: Stage,
    submitted: Schema.Boolean,
    code: ErrorCode,
    causeCode: ErrorCode,
    errorKind: Schema.Literals(["office", "type-error", "error", "unknown"]),
  },
) {}

export function officeStagingFailure(
  operationId: string,
  stage: OfficeStagingPhase,
  submitted: boolean,
  error?: unknown,
): OfficeStagingFailure {
  if (error instanceof OfficeStagingFailure) return error;
  const known = OfficeErrors.find((Type) => error instanceof Type);
  const code =
    known && error instanceof Error
      ? Schema.decodeUnknownSync(ErrorCode)(Reflect.get(error, "code"))
      : "UNAVAILABLE";
  return withCause(
    new OfficeStagingFailure({
      operationId,
      stage,
      submitted,
      code: submitted ? "OUTCOME_UNKNOWN" : code,
      causeCode: code,
      errorKind: known
        ? "office"
        : error instanceof TypeError
          ? "type-error"
          : error instanceof Error
            ? "error"
            : "unknown",
    }),
    error,
  );
}

export function stagingFailureDetail(error: OfficeStagingFailure) {
  return {
    ...safeFailure(error.code, error.operationId),
    stage: error.stage,
    causeCode: error.causeCode,
    errorKind: error.errorKind,
    submission: error.submitted ? "unknown" : "not-submitted",
    message: error.submitted
      ? "Staging may have submitted bytes. Observe the original upload; do not replay it."
      : "Staging failed before upload submission.",
  };
}
