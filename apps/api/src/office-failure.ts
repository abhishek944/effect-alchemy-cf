import { withCause } from "@starter/diagnostics";
import {
  OfficeErrors,
  OfficeUnavailable,
  safeFailure,
  type OfficeError,
} from "@starter/office-contract";

/** Foreign runtime/storage faults are not evidence of a denied association. */
export function officeCaught(cause: unknown): OfficeError {
  for (const Type of OfficeErrors) if (cause instanceof Type) return cause;
  return withCause(new OfficeUnavailable(safeFailure("UNAVAILABLE")), cause);
}
