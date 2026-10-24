import { reportFailure } from "@starter/diagnostics";

/** One bounded record for a theme dispatch whose observation/receipt was uncertain. */
export const reportThemeObservation = (
  error: unknown,
  operationId: string,
  callId: string,
  phase: "receipt-lookup" | "dispatch" | "receipt-recovery",
  outcome: "confirmed" | "unknown",
  status?: number,
): void =>
  reportFailure(error ?? new Error("Theme dispatch outcome was not observed"), {
    component: "chat-account",
    operation: "theme.dispatch",
    phase,
    reason: outcome === "unknown" ? "theme_outcome_unknown" : "theme_dispatch_recovered",
    operationId,
    callId,
    outcome,
    ...(status === undefined ? {} : { status }),
    event: outcome === "unknown" ? "application.failure" : "application.recovery",
  });
