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

/** Safe metadata only: never retain raw causes, bodies, headers or recipient data. */
export class IntegrationError extends Data.TaggedError("IntegrationError")<{
  readonly provider: IntegrationProvider;
  readonly kind: IntegrationErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;
}> {}
