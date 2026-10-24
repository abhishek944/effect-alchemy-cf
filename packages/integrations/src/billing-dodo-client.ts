import { withCause } from "@starter/diagnostics";
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
import { billingFailure, type BillingError, type ProviderOptions } from "./billing.ts";

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
const classified = (error: unknown, safety: Safety): BillingError => {
  if (error instanceof NotFoundError)
    return billingFailure("NotFound", "provider-not-found", "dodo");
  if (error instanceof ConflictError)
    return billingFailure("Conflict", "provider-conflict", "dodo");
  if (error instanceof RateLimitError) return billingFailure("Busy", "provider-rate-limit", "dodo");
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError) {
    return billingFailure("InvalidInput", "provider-rejected-input", "dodo");
  }
  if (error instanceof APIConnectionError || error instanceof APIUserAbortError) {
    return billingFailure(
      safety === "ambiguous" ? "UnknownOutcome" : "Provider",
      "provider-transport",
      "dodo",
    );
  }
  if (error instanceof APIError && error.status !== undefined && error.status < 500) {
    return billingFailure("Provider", "provider-http-rejected", "dodo");
  }
  return billingFailure(
    safety === "ambiguous" ? "UnknownOutcome" : "Provider",
    "provider-unexpected",
    "dodo",
  );
};

/** The existing kind stays public; the SDK failure is retained in server memory only. */
const sdkError = (error: unknown, safety: Safety): BillingError =>
  withCause(classified(error, safety), error);

/** `unwrap` verifies with standardwebhooks and then casts; parse and HMAC failures reject. */
const classifiedWebhook = (error: unknown): BillingError => {
  if (error instanceof SyntaxError)
    return billingFailure("Signature", "webhook-parse-failed", "dodo");
  if (error instanceof Error && error.name === "WebhookVerificationError") {
    return billingFailure("Signature", "webhook-signature-invalid", "dodo");
  }
  return billingFailure("Provider", "webhook-verification-unexpected", "dodo");
};

export const webhookError = (error: unknown): BillingError =>
  withCause(classifiedWebhook(error), error);

const call = <A>(run: (signal: AbortSignal) => Promise<A>, safety: Safety) =>
  Effect.tryPromise({ try: run, catch: (error) => sdkError(error, safety) }).pipe(
    Effect.timeout(DEADLINE),
    // One bounded attempt: keep the deadline origin and name the provider stage.
    Effect.catchTag("TimeoutError", (timeout) =>
      Effect.fail(
        withCause(
          billingFailure(
            safety === "ambiguous" ? "UnknownOutcome" : "Provider",
            "provider-deadline",
            "dodo",
          ),
          timeout,
        ),
      ),
    ),
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
    if (apiKey === null)
      return Effect.fail(billingFailure("Configuration", "provider-credentials", "dodo"));
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
    } catch (cause) {
      return Effect.fail(
        withCause(billingFailure("Configuration", "provider-client-init", "dodo"), cause),
      );
    }
  });

  return { client, call };
};
