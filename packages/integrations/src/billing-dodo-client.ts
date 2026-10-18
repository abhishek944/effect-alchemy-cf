import { Effect, Redacted } from "effect";
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  BadRequestError,
  ConflictError,
  DodoPayments,
  NotFoundError,
  RateLimitError,
  UnprocessableEntityError,
} from "dodopayments";
import { billingError, type BillingError, type ProviderOptions } from "./billing.ts";

/**
 * One bounded attempt: SDK retries are off, its one-minute default is lowered to
 * five seconds, and the outer deadline aborts the request through RequestOptions.
 */
const REQUEST_TIMEOUT_MS = 5_000;
const DEADLINE = "6 seconds";

export type Safety = "ambiguous" | "definite";

export const printable = (value: Redacted.Redacted): string | null => {
  const raw = Redacted.value(value);
  return /^[\x21-\x7e]+$/.test(raw) ? raw : null;
};

/** Definite 4xx rejections are never retried; transport, abort and 5xx stay ambiguous. */
const sdkError = (error: unknown, safety: Safety): BillingError => {
  if (error instanceof NotFoundError) return billingError("NotFound");
  if (error instanceof ConflictError) return billingError("Conflict");
  if (error instanceof RateLimitError) return billingError("Busy");
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError) {
    return billingError("InvalidInput");
  }
  if (error instanceof APIConnectionError || error instanceof APIUserAbortError) {
    return billingError(safety === "ambiguous" ? "UnknownOutcome" : "Provider");
  }
  if (error instanceof APIError && error.status !== undefined && error.status < 500) {
    return billingError("Provider");
  }
  return billingError(safety === "ambiguous" ? "UnknownOutcome" : "Provider");
};

/** `unwrap` verifies with standardwebhooks and then casts; parse and HMAC failures reject. */
export const webhookError = (error: unknown): BillingError => {
  if (error instanceof SyntaxError) return billingError("Signature");
  if (error instanceof Error && error.name === "WebhookVerificationError") {
    return billingError("Signature");
  }
  return billingError("Provider");
};

const call = <A>(run: (signal: AbortSignal) => Promise<A>, safety: Safety) =>
  Effect.tryPromise({ try: run, catch: (error) => sdkError(error, safety) }).pipe(
    Effect.timeoutOrElse({
      duration: DEADLINE,
      orElse: () =>
        Effect.fail(billingError(safety === "ambiguous" ? "UnknownOutcome" : "Provider")),
    }),
  );

export interface DodoSdk {
  readonly client: Effect.Effect<DodoPayments, BillingError>;
  readonly call: typeof call;
}

export const makeDodoSdk = (options: ProviderOptions): DodoSdk => {
  let cached: DodoPayments | null = null;

  const client = Effect.suspend(() => {
    if (cached !== null) return Effect.succeed(cached);
    const apiKey = printable(options.apiKey);
    if (apiKey === null) return Effect.fail(billingError("Configuration"));
    try {
      cached = new DodoPayments({
        bearerToken: apiKey,
        environment: options.live ? "live_mode" : "test_mode",
        // Never inherit DODO_PAYMENTS_LOG: SDK logs can include request details.
        logLevel: "off",
        maxRetries: 0,
        timeout: REQUEST_TIMEOUT_MS,
      });
      return Effect.succeed(cached);
    } catch {
      return Effect.fail(billingError("Configuration"));
    }
  });

  return { client, call };
};
