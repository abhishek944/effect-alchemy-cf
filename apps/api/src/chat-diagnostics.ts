import { Cause, Effect } from "effect";
import {
  reportFailureEffect,
  withCause,
  withDiagnostic,
  type FailureContext,
} from "@starter/diagnostics";
import { ChatUnavailable } from "./chat-model.ts";

/**
 * Attach a validated safe numeric private status as a non-enumerable own
 * `status` field: the exact key `classification()` reads via
 * `own(value, "status")`, so the status is emitted in the cause entry.
 * Non-enumerable, so schema fields, spreads and JSON output are unaffected.
 */
export const withPrivateStatus = <E extends Error>(error: E, status: unknown): E => {
  if (typeof status === "number" && Number.isSafeInteger(status) && status >= 100 && status <= 599)
    Object.defineProperty(error, "status", { value: status, configurable: true });
  return error;
};

/** Typed private-call failure: fixed reason, safe status, preserved cause. */
export const privateUnavailable = (
  reason: string,
  status: unknown,
  cause?: unknown,
): ChatUnavailable => {
  const error = withPrivateStatus(withDiagnostic(new ChatUnavailable(), reason), status);
  return cause === undefined ? error : withCause(error, cause);
};

/** Observe a best-effort bookkeeping effect, then keep its recovery behavior. */
export const ignoreReport =
  (context: FailureContext) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
    effect.pipe(
      Effect.tapCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : reportFailureEffect(cause, context),
      ),
      Effect.ignore,
    );
