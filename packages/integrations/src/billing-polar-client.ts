import { Effect, Redacted } from "effect";
import { createPolar, type Polar } from "@polar-sh/sdk/2026-10";
import { PolarClientError, PolarRateLimitError } from "@polar-sh/sdk";
import { billingError, type BillingError, type ProviderOptions } from "./billing.ts";

/**
 * Polar timeouts are seconds and 1.0.2 has no built-in retries. RequestOptions
 * exposes no abort signal, so the SDK timeout is the only network bound; the
 * outer Effect deadline interrupts the fiber but cannot cancel the fetch.
 */
const REQUEST_TIMEOUT_SECONDS = 5;
const DEADLINE = "6 seconds";

export type Safety = "ambiguous" | "definite";

export const printable = (value: Redacted.Redacted): string | null => {
  const raw = Redacted.value(value);
  return /^[\x21-\x7e]+$/.test(raw) ? raw : null;
};

/** Definite 4xx rejections are never retried; transport, abort and 5xx stay ambiguous. */
const sdkError = (error: unknown, safety: Safety): BillingError => {
  if (error instanceof PolarRateLimitError) return billingError("Busy");
  if (error instanceof PolarClientError) {
    if (error.statusCode === 404) return billingError("NotFound");
    if (error.statusCode === 409) return billingError("Conflict");
    if (error.statusCode === 400 || error.statusCode === 422) return billingError("InvalidInput");
    if (error.statusCode < 500) return billingError("Provider");
  }
  return billingError(safety === "ambiguous" ? "UnknownOutcome" : "Provider");
};

const call = <A>(run: () => Promise<A>, safety: Safety) =>
  Effect.tryPromise({ try: () => run(), catch: (error) => sdkError(error, safety) }).pipe(
    Effect.timeoutOrElse({
      duration: DEADLINE,
      orElse: () =>
        Effect.fail(billingError(safety === "ambiguous" ? "UnknownOutcome" : "Provider")),
    }),
  );

export interface PolarSdk {
  readonly client: Effect.Effect<Polar, BillingError>;
  readonly call: typeof call;
}

export const makePolarSdk = (options: ProviderOptions): PolarSdk => {
  let cached: Polar | null = null;

  const client = Effect.suspend(() => {
    if (cached !== null) return Effect.succeed(cached);
    const accessToken = printable(options.apiKey);
    if (accessToken === null) return Effect.fail(billingError("Configuration"));
    try {
      cached = createPolar({
        accessToken,
        environment: options.live ? "production" : "sandbox",
        organizationId: options.accountId,
        timeout: REQUEST_TIMEOUT_SECONDS,
      });
      return Effect.succeed(cached);
    } catch {
      return Effect.fail(billingError("Configuration"));
    }
  });

  return { client, call };
};
