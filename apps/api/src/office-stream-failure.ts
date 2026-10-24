import {
  withCause,
  withDiagnostic,
  reportFailure,
  type FailureContext,
} from "@starter/diagnostics";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";

export type OfficeStreamCompletion =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown };
export const officeStreamUnavailable = (reason: string, cause?: unknown) =>
  withCause(withDiagnostic(new OfficeUnavailable(safeFailure("UNAVAILABLE")), reason), cause);

/** Per-transfer causes replace lossy flags; no global state or data/chunk retention. */
export function officeStreamFailures() {
  const causes: { readonly original: unknown; readonly error: Error }[] = [];
  const capture = (cause: unknown, reason: string) => {
    if (!causes.some((entry) => entry.original === cause))
      causes.push({ original: cause, error: withCause(officeStreamUnavailable(reason), cause) });
  };
  const error = () =>
    withCause(
      officeStreamUnavailable("transfer-failed"),
      new AggregateError(
        causes.map((entry) => entry.error),
        "Private transfer failed",
      ),
    );
  const observe = (actual: Promise<unknown>, reason: string): Promise<OfficeStreamCompletion> =>
    actual.then(
      () => ({ ok: true }),
      (cause: unknown) => {
        capture(cause, reason);
        return { ok: false, error: cause };
      },
    );
  return {
    capture,
    error,
    observe,
    get failed() {
      return causes.length > 0;
    },
  };
}

/** Source failure must not skip the owning finish join. */
export async function officeStreamFinish(
  source: () => Promise<void>,
  finish: () => Promise<void>,
  failures: ReturnType<typeof officeStreamFailures>,
) {
  let failed = false;
  try {
    await source();
  } catch (cause) {
    failures.capture(cause, "source-join");
    failed = true;
  }
  try {
    await finish();
  } catch (cause) {
    failures.capture(cause, "transfer-finish");
    failed = true;
  }
  if (failed) throw failures.error();
}

export function officeStreamCompletion(
  failures: ReturnType<typeof officeStreamFailures>,
  pulling: () => Promise<void> | undefined,
  context: FailureContext | undefined,
  facts: () => {
    bytes: number;
    sourceEOF: boolean;
    ended: boolean;
    revoked: boolean;
    aborted: boolean;
    deadlineAt: number;
  },
) {
  let resolveDone: (() => void) | undefined, rejectDone: ((error: unknown) => void) | undefined;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  void done.catch(() => undefined);
  officeStreamTerminal(context, done, pulling, failures, facts);
  return {
    settle(fault: boolean) {
      if (fault) rejectDone?.(failures.error());
      else resolveDone?.();
    },
    async drain() {
      const terminal = await Promise.allSettled([done]);
      const joined = await Promise.allSettled([pulling()]);
      const errors = [...terminal, ...joined]
        .filter((result) => result.status === "rejected")
        .map((result): unknown => result.reason);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Private transfer join failed");
    },
  };
}

/** One terminal record after actual outgoing pull settlement, not an abort ACK or source-only join. */
function officeStreamTerminal(
  context: FailureContext | undefined,
  done: Promise<void>,
  pulling: () => Promise<void> | undefined,
  failures: ReturnType<typeof officeStreamFailures>,
  facts: () => {
    bytes: number;
    sourceEOF: boolean;
    ended: boolean;
    revoked: boolean;
    aborted: boolean;
    deadlineAt: number;
  },
) {
  if (context === undefined) return;
  const report = async () => {
    try {
      await pulling();
    } catch (cause) {
      failures.capture(cause, "outgoing-pull");
    }
    const actual = facts();
    const complete = actual.ended && actual.sourceEOF && !failures.failed;
    reportFailure(failures.failed ? failures.error() : undefined, {
      ...context,
      event: "application.complete",
      level: "INFO",
      phase: complete
        ? "transfer-complete"
        : failures.failed
          ? "transfer-failed"
          : actual.revoked || actual.aborted
            ? "transfer-cancelled"
            : "transfer-incomplete",
      reason: actual.sourceEOF ? "source-eof" : "source-not-eof",
      bytes: actual.bytes,
      deadlineAt: actual.deadlineAt,
      outcome: complete
        ? (context.outcome ?? "confirmed")
        : context.outcome === "not-submitted"
          ? "not-submitted"
          : "unknown",
    });
  };
  void done.then(report, report);
}
