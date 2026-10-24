import { Cause, Effect } from "effect";
import { OfficeErrors, OfficeUnavailable } from "@starter/office-contract";
import { officeFailureReported, officeReportCause } from "./office-diagnostic-report.ts";

/** Final Response owners only. Typed domain denials stay silent; reported reasons never repeat. */
export function reportOfficeHttpFailure(
  cause: Cause.Cause<unknown>,
  operation: string,
): Effect.Effect<void> {
  if (officeFailureReported(cause)) return Effect.void;
  const expected = cause.reasons.every(
    (reason) =>
      Cause.isFailReason(reason) &&
      !(reason.error instanceof OfficeUnavailable) &&
      OfficeErrors.some((Type) => reason.error instanceof Type),
  );
  return expected ? Effect.void : officeReportCause(cause, { component: "office.http", operation });
}
