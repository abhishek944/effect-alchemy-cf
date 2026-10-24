import { Cause, Effect, ErrorReporter } from "effect";
import {
  type diagnosticMetadata,
  reportedFailure,
  reportFailure,
  reportFailureEffect,
  type FailureContext,
} from "@starter/diagnostics";
import {
  OfficeErrors,
  OfficeUnavailable,
  safeFailure,
  type OfficeError,
} from "@starter/office-contract";
import { officeDenied } from "./office-private-authority.ts";

/** Application-owned classification of one Office failure, never derived from foreign text. */
export type OfficeFailureKind = "denial" | "capacity" | "cancelled" | "fault";
export type OfficeDiagnosticMetadata = ReturnType<typeof diagnosticMetadata>;
/** Branch-owner report: fixed label plus the already-validated original association. */
export type OfficeReport = FailureContext & {
  readonly component: string;
  readonly operation: string;
  readonly reason: string;
};
/** Branch label; the Office admission boundary owns the component unless one is supplied. */
export type OfficeBranch = Partial<FailureContext> & {
  readonly operation: string;
  readonly reason: string;
};

const isOfficeError = (error: unknown): error is OfficeError =>
  OfficeErrors.some((Type) => error instanceof Type);
const isAbort = (error: unknown) => error instanceof Error && error.name === "AbortError";
/** Native non-enumerable cause only; the value is compared, never projected as text. */
const nativeCause = (value: object): unknown => {
  const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(
    value,
    "cause",
  );
  return descriptor === undefined ? undefined : (descriptor.value as unknown);
};

/** A reason is handled only when its own error carries the branch-owner report marker. */
const reportedReason = (reason: Cause.Reason<unknown>): boolean =>
  Cause.isFailReason(reason)
    ? ErrorReporter.isIgnored(reason.error)
    : Cause.isDieReason(reason)
      ? ErrorReporter.isIgnored(reason.defect)
      : false;
/** Reasons whose own failure was not already reported; nested causes stay with their reason. */
const remainingReasons = (cause: Cause.Cause<unknown>) =>
  cause.reasons.filter((reason) => !reportedReason(reason));

/** Least to most alarming; one mixed cause keeps its most alarming reason. */
const RANK: Readonly<Record<OfficeFailureKind, number>> = {
  cancelled: 0,
  denial: 1,
  capacity: 2,
  fault: 3,
};
const MAX_DEPTH = 4;
const MAX_BREADTH = 8;
const worstOf = (kinds: readonly OfficeFailureKind[]): OfficeFailureKind =>
  kinds.reduce<OfficeFailureKind>(
    (worst, kind) => (RANK[kind] > RANK[worst] ? kind : worst),
    "cancelled",
  );
/** Own data property only: a foreign accessor or hostile proxy is never invoked. */
const ownArray = (value: object, key: string): readonly unknown[] | undefined => {
  try {
    const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    return Array.isArray(descriptor.value) ? (descriptor.value as readonly unknown[]) : undefined;
  } catch {
    return undefined;
  }
};
/** Native aggregate members only, bounded; omitted, invalid or oversized input is a fault. */
const aggregateMembers = (value: AggregateError): readonly unknown[] | undefined => {
  const members = ownArray(value, "errors");
  return members === undefined || members.length === 0 || members.length > MAX_BREADTH
    ? undefined
    : members;
};

/** One value's own kind. Aggregated causes expose every failure they carry, no laundering. */
const kindOfValue = (value: unknown, depth: number): OfficeFailureKind => {
  // A deeply nested or cyclic Error graph is a fault; classification never recurses unbounded.
  if (depth > MAX_DEPTH) return "fault";
  if (isAbort(value)) return "cancelled";
  if (value instanceof AggregateError) {
    const members = aggregateMembers(value);
    return members === undefined
      ? "fault"
      : worstOf(members.map((nested: unknown) => kindOfValue(nested, depth + 1)));
  }
  if (!isOfficeError(value)) return "fault";
  if (value instanceof OfficeUnavailable) {
    if (value.code === "BUSY") return "capacity";
    // A facade that only wraps an abort is cancellation; any other wrapped detail is infra.
    const wrapped = nativeCause(value);
    return wrapped !== undefined && kindOfValue(wrapped, depth + 1) === "cancelled"
      ? "cancelled"
      : "fault";
  }
  // A typed domain verdict stays ordinary unless its aggregated detail is more alarming.
  const nested = nativeCause(value);
  const nestedKind =
    nested instanceof AggregateError ? kindOfValue(nested, depth + 1) : ("denial" as const);
  return worstOf(["denial", nestedKind]);
};

const kindOfReason = (reason: Cause.Reason<unknown>): OfficeFailureKind =>
  Cause.isFailReason(reason)
    ? kindOfValue(reason.error, 0)
    : Cause.isDieReason(reason)
      ? kindOfValue(reason.defect, 0)
      : "cancelled";

/** Every retained reason is classified; any real fault outranks denial, capacity and cancel. */
export function officeFailureKind(cause: Cause.Cause<unknown>): OfficeFailureKind {
  return cause.reasons.length === 0 ? "fault" : worstOf(cause.reasons.map(kindOfReason));
}

const disposition = (kind: OfficeFailureKind): Pick<FailureContext, "event" | "level"> =>
  kind === "capacity"
    ? { event: "application.denial", level: "WARN" }
    : kind === "cancelled"
      ? { event: "application.cancelled" }
      : kind === "denial"
        ? { event: "application.denial" }
        : { event: "application.failure" };
/** Only a denial verdict proves nothing was admitted; cancellation and faults cannot. */
const outcome = (kind: OfficeFailureKind): FailureContext["outcome"] =>
  kind === "denial" || kind === "capacity" ? "not-submitted" : "unknown";
const defaultReason = (kind: OfficeFailureKind): string =>
  kind === "denial"
    ? "denied"
    : kind === "capacity"
      ? "capacity-exhausted"
      : kind === "cancelled"
        ? "cancelled"
        : "unexpected-fault";

/** Report once at the branch that actually rejected, then mark so no owner repeats it. */
export function officeReportBranch<E extends Error>(error: E, branch: OfficeBranch): E {
  if (ErrorReporter.isIgnored(error)) return error;
  const context = { component: "office.admission", ...branch };
  const kind = kindOfValue(error, 0);
  reportFailure(error, {
    ...context,
    ...disposition(kind),
    outcome: context.outcome ?? outcome(kind),
  });
  return reportedFailure(error);
}
export const officeDeny = (branch: OfficeBranch) => officeReportBranch(officeDenied(), branch);
export const officeBusy = (branch: OfficeBranch) =>
  officeReportBranch(new OfficeUnavailable(safeFailure("BUSY")), branch);

/** Final owner: one record for each cause reason no branch owner already reported. */
export const officeReportCause = (
  cause: Cause.Cause<unknown>,
  context: Omit<OfficeReport, "reason"> & { readonly reason?: string | undefined },
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const remaining = remainingReasons(cause);
    if (remaining.length === 0) return;
    // Keep the unreported reasons (including other failures and defects) exactly as written.
    const reportable = Cause.fromReasons<unknown>(remaining);
    const kind = officeFailureKind(reportable);
    yield* reportFailureEffect(reportable, {
      ...context,
      reason: context.reason ?? defaultReason(kind),
      ...disposition(kind),
      outcome: context.outcome ?? outcome(kind),
    });
  });
/** True only when every actual Fail/Die reason was reported by its owning branch. */
export const officeFailureReported = (cause: Cause.Cause<unknown>): boolean =>
  remainingReasons(cause).length === 0;
