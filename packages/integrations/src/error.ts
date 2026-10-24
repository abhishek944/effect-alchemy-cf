import { Data } from "effect";

export type IntegrationProvider = "cloudflare" | "resend" | "slack";
export type IntegrationErrorKind =
  | "InvalidConfiguration"
  | "InvalidInput"
  | "Transport"
  | "Timeout"
  | "Http"
  | "InvalidResponse"
  | "Rejected";

/** Safe metadata only: callers see these fields, never raw causes, bodies, headers or recipients.
 * Adapters may attach the original failure as a non-enumerable in-memory cause; nothing
 * serializes or returns it. */
export class IntegrationError extends Data.TaggedError("IntegrationError")<{
  readonly provider: IntegrationProvider;
  readonly kind: IntegrationErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;
}> {}
