import {
  reportEvent,
  reportFailure,
  withCause,
  withDiagnostic,
  type FailureContext,
} from "@starter/diagnostics";

export const officeObserve = <A>(actual: Promise<A>): Promise<A> => {
  void actual.catch(() => undefined);
  return actual;
};

/** Finite physical-boundary evidence; the caller still owns cancellation and real joins. */
export function officeLifecycle(context: () => FailureContext, failed?: (cause: unknown) => void) {
  const event = (phase: string, extra: Partial<FailureContext> = {}) =>
    reportEvent({ ...context(), phase, ...extra });
  const step = async <A>(phase: string, actual: () => Promise<A>): Promise<A> => {
    const began = Date.now();
    event(phase, { reason: "entered" });
    try {
      const value = await Promise.resolve().then(actual);
      event(phase, { reason: "completed", outcome: "confirmed", durationMs: Date.now() - began });
      return value;
    } catch (cause) {
      const error =
        cause instanceof Error
          ? cause
          : withCause(withDiagnostic(new Error("Office lifecycle failed"), phase), cause);
      failed?.(error);
      reportFailure(error, {
        ...context(),
        event: "application.phase",
        phase,
        reason: "failed",
        outcome: "unknown",
        durationMs: Date.now() - began,
      });
      throw error;
    }
  };
  return { event, step, context };
}
