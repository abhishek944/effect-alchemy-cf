import { Cause } from "effect";
import { withCause } from "@starter/diagnostics";
import {
  OfficeErrors,
  OfficeInvalid,
  OfficeUnavailable,
  safeFailure,
  type OfficeError,
} from "@starter/office-contract";

export function adapterFailure(cause: unknown): OfficeError {
  for (const Type of OfficeErrors) if (cause instanceof Type) return cause;
  return withCause(new OfficeUnavailable(safeFailure("UNAVAILABLE")), cause);
}
export const invalidBytes = () => new OfficeInvalid(safeFailure("CONTENT_REQUIRED"));

/** Check existing cause links before attaching a secondary failure to its primary. */
function references(value: unknown, target: unknown, seen = new Set<object>()): boolean {
  if (value === target) return true;
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);
  if (Cause.isCause(value))
    return value.reasons.some((reason) =>
      Cause.isFailReason(reason)
        ? references(reason.error, target, seen)
        : Cause.isDieReason(reason) && references(reason.defect, target, seen),
    );
  const cause: unknown = Object.getOwnPropertyDescriptor(value, "cause")?.value;
  if (cause !== undefined && references(cause, target, seen)) return true;
  const errors: unknown = Object.getOwnPropertyDescriptor(value, "errors")?.value;
  return (
    value instanceof AggregateError &&
    Array.isArray(errors) &&
    errors.some((error: unknown) => references(error, target, seen))
  );
}

/** Preserve the primary instance when cleanup is independent; never attach a back-reference. */
export function streamFailure(primary: unknown, cleanup: readonly unknown[]): unknown {
  const secondary = [...new Set(cleanup)].filter((error) => error !== primary);
  if (!secondary.length) return primary;
  if (primary instanceof Error && !secondary.some((error) => references(error, primary)))
    return withCause(primary, new AggregateError(secondary, "Native stream cleanup failed"));
  const cause = new AggregateError([primary, ...secondary], "Native stream and cleanup failed");
  // A cleanup exception can itself point to the primary. Keep both originals under
  // a fresh, identically classified wrapper rather than create primary.cause -> primary.
  for (const Type of OfficeErrors)
    if (primary instanceof Type)
      return withCause(
        new Type({
          code: primary.code,
          message: primary.message,
          operationId: primary.operationId,
        }),
        cause,
      );
  return cause;
}
