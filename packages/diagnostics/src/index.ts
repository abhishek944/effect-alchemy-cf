import { Cause, Effect } from "effect";
import { contextFields, label, requestDiagnosticContext, type FailureContext } from "./context.ts";
export {
  withDiagnostic,
  diagnosticMetadata,
  requestDiagnosticContext,
  type FailureContext,
} from "./context.ts";
import { classification, own } from "./classification.ts";
export { withCause, reportedFailure } from "./causes.ts";
export { DIAGNOSTIC_TYPES, DIAGNOSTIC_CODES, DIAGNOSTIC_FRAME_PATTERN } from "./classification.ts";

/** Safe projection only; the original Cause/Error chain remains unchanged in memory. */
export function failureRecord(error: unknown, context: FailureContext) {
  const causes: ReturnType<typeof classification>[] = [];
  const seen = new Set<object>();
  let truncated = false;
  const visit = (value: unknown, depth: number): void => {
    if (causes.length >= 12 || depth > 8) {
      truncated = true;
      return;
    }
    if (typeof value !== "object" || value === null) {
      causes.push({ type: "Unclassified" });
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    if (Cause.isCause(value)) {
      for (const reason of value.reasons.slice(0, 12)) {
        if (causes.length >= 12) {
          truncated = true;
          break;
        }
        if (Cause.isInterruptReason(reason)) causes.push({ type: "Interrupted" });
        else visit(Cause.isFailReason(reason) ? reason.error : reason.defect, depth + 1);
      }
      if (value.reasons.length > 12) truncated = true;
      return;
    }
    causes.push(classification(value));
    const cause = own(value, "cause");
    if (cause !== undefined) visit(cause, depth + 1);
    const errors = own(value, "errors");
    if (value instanceof AggregateError && Array.isArray(errors)) {
      for (const nested of errors.slice(0, 12)) visit(nested, depth + 1);
      if (errors.length > 12) truncated = true;
    }
  };
  try {
    if (error !== undefined) visit(error, 0);
  } catch {
    // A hostile proxy/getter is untrusted diagnostic input, not a new business failure.
    truncated = true;
  }
  return {
    timestamp: new Date().toISOString(),
    event: context.event ?? "application.failure",
    component: label(context.component),
    operation: label(context.operation),
    ...contextFields(context),
    causes,
    ...(truncated ? { causes_truncated: true } : {}),
  };
}

/** Read the existing Effect request scope; never copy mutable context between requests. */
export const reportFailureEffect = (error: unknown, context: FailureContext): Effect.Effect<void> =>
  Effect.gen(function* () {
    const inherited = yield* requestDiagnosticContext;
    yield* Effect.sync(() =>
      reportFailure(error, {
        ...inherited,
        ...context,
        requestId: context.requestId ?? inherited.requestId,
        service: context.service ?? inherited.service,
        stage: context.stage ?? inherited.stage,
        release: context.release ?? inherited.release,
      }),
    );
  });

/** Call at final handling/recovery owners, not at every propagation layer. */
export function reportFailure(error: unknown, context: FailureContext): void {
  const record = failureRecord(error, context);
  const level =
    context.level ??
    (context.event === "application.denial" ||
    context.event === "application.cancelled" ||
    context.event === "application.phase" ||
    context.event === "application.complete"
      ? "INFO"
      : context.event === "application.recovery"
        ? "WARN"
        : "ERROR");
  const line = JSON.stringify({ ...record, level });
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
}

/** Finite lifecycle evidence at the physical owner; no timer, polling or separate sink. */
export const reportEvent = (context: FailureContext): void =>
  reportFailure(undefined, { ...context, event: context.event ?? "application.phase" });
export const reportEventEffect = (context: FailureContext): Effect.Effect<void> =>
  reportFailureEffect(undefined, { ...context, event: context.event ?? "application.phase" });
