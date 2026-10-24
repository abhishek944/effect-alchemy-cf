import { withCause } from "@starter/diagnostics";
import { billingFailure, type BillingError, type ProviderId } from "@starter/integrations/billing";
import { Effect, type Duration } from "effect";

/**
 * Fixed phase labels: the reason names the dependency that was pending when the shared
 * deadline fired. Reasons stay finite application strings; no step, provider or SQL text.
 */
export type BillingPhase =
  | "decode"
  | "retrieve"
  | "prepare"
  | "save"
  | "snapshot"
  | "hook"
  | "finalize"
  | "reserve"
  | "customer"
  | "checkout"
  | "complete";

const reasons: Readonly<Record<BillingPhase, string>> = {
  decode: "deadline-decode",
  retrieve: "deadline-retrieve",
  prepare: "deadline-prepare",
  save: "deadline-save",
  snapshot: "deadline-snapshot",
  hook: "deadline-hook",
  finalize: "deadline-finalize",
  reserve: "deadline-reserve",
  customer: "deadline-customer",
  checkout: "deadline-checkout",
  complete: "deadline-complete",
};

export interface BillingDeadlineOptions {
  readonly duration: Duration.Input;
  readonly kind: BillingError["kind"];
  /** Fiber-local reader: one invocation owns one phase value, never shared context. */
  readonly phase: () => BillingPhase;
  readonly provider?: ProviderId | undefined;
}

/**
 * Keep one deadline per existing scope instead of a new per-step budget. The original
 * TimeoutError stays the internal cause; the kind, uncertainty and retry behavior are
 * unchanged, and only the record gains the expired phase.
 */
export const billingDeadline =
  (options: BillingDeadlineOptions) =>
  <A, E, R>(run: Effect.Effect<A, E, R>): Effect.Effect<A, E | BillingError, R> =>
    run.pipe(
      Effect.timeout(options.duration),
      Effect.catchTag("TimeoutError", (timeout) =>
        Effect.fail(
          withCause(
            billingFailure(options.kind, reasons[options.phase()], options.provider),
            timeout,
          ),
        ),
      ),
    );
