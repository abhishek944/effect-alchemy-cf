import { withDiagnostic } from "@starter/diagnostics";
import { OfficeForbidden, safeFailure } from "@starter/office-contract";
import type { ViewRecord } from "@starter/office-server/ports";

export const officeDenied = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
/** Fixed diagnostics only; never a catch callback receiving foreign error text. */
export const officeDeniedReason = (reason: string) => withDiagnostic(officeDenied(), reason);
const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** Renewal changes expiry, never the captured owner/target/generation/revision/authority identity. */
export const officeSameView = (left: ViewRecord, right: ViewRecord): boolean =>
  officeSame(
    { ...left, view: { ...left.view, expiresAt: 0 } },
    { ...right, view: { ...right.view, expiresAt: 0 } },
  );
/** Finite DTO equality only, never original caller proof. */
export function officeSame(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((value: unknown, index) => officeSame(value, right[index]))
    );
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && officeSame(left[key], right[key]))
  );
}
