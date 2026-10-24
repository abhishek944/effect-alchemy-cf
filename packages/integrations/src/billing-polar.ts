import { withCause } from "@starter/diagnostics";
import { Effect } from "effect";
import { webhooks } from "@polar-sh/sdk/2026-10";
import {
  billingFailure,
  type BillingAdapter,
  type BillingError,
  type ProviderOptions,
} from "./billing.ts";
import { makePolarSdk, printable } from "./billing-polar-client.ts";
import { polarAccountId, polarEventKind, polarResourceId } from "./billing-polar-normalize.ts";
import { makePolarRetrieve } from "./billing-polar-retrieve.ts";

/** `validateEvent` verifies the HMAC before parsing and reports unknown signed types. */
const verificationKind = (error: unknown): BillingError => {
  if (error instanceof webhooks.PolarWebhookVerificationError)
    return billingFailure("Signature", "webhook-signature-invalid", "polar");
  if (error instanceof webhooks.PolarWebhookError)
    return billingFailure("Signature", "webhook-payload-invalid", "polar");
  return billingFailure("Provider", "webhook-verification-unexpected", "polar");
};

/** The kind stays public; the verification failure is retained in server memory only. */
const verificationError = (error: unknown): BillingError =>
  withCause(verificationKind(error), error);

/**
 * Polar adapter. Customers use the parent-scoped external key, which is unique
 * and immutable, so a duplicate create recovers by external-id lookup instead
 * of retrying the create. The account id scopes the client and webhook checks.
 */
export const makePolarBilling = (options: ProviderOptions): BillingAdapter => {
  const sdkClient = makePolarSdk(options);
  const { client: sdk, call } = sdkClient;

  return {
    id: "polar",

    customer: (input) =>
      Effect.gen(function* () {
        const client = yield* sdk;
        const created = yield* call(
          () =>
            client.customers.create({
              external_id: input.key,
              email: input.email,
              name: input.name.trim() === "" ? null : input.name,
            }),
          "ambiguous",
        ).pipe(
          Effect.catchIf(
            (error) => error.kind === "InvalidInput" || error.kind === "Conflict",
            (original) =>
              call(() => client.customers.getExternal(input.key), "definite").pipe(
                Effect.catchIf(
                  (error) => error.kind === "NotFound",
                  () => Effect.fail(original),
                ),
              ),
          ),
        );
        return created.id;
      }),

    checkout: (input) =>
      Effect.gen(function* () {
        const client = yield* sdk;
        const created = yield* call(
          () =>
            client.checkouts.create({
              products: [input.productId],
              customer_id: input.customerId,
              success_url: input.returnUrl,
              return_url: input.returnUrl,
              metadata: { request_key: input.requestId },
            }),
          "ambiguous",
        );
        return { id: created.id, url: created.url };
      }),

    portal: (input) =>
      Effect.gen(function* () {
        const client = yield* sdk;
        const session = yield* call(
          () =>
            client.customerSessions.create({
              customer_id: input.customerId,
              return_url: input.returnUrl,
            }),
          "definite",
        );
        return session.customer_portal_url;
      }),

    /**
     * Polar 2026-10 has no dispute webhook events; a signed unknown type is
     * acknowledged with no resource so the parent never invents coverage.
     */
    verify: (raw, headers) =>
      Effect.gen(function* () {
        const eventId = headers.get("webhook-id");
        if (eventId === null || eventId === "")
          return yield* Effect.fail(billingFailure("Signature", "webhook-id-missing", "polar"));
        const secret = printable(options.webhookSecret);
        if (secret === null)
          return yield* Effect.fail(
            billingFailure("Configuration", "webhook-secret-invalid", "polar"),
          );
        const outcome = yield* Effect.tryPromise({
          try: async () => {
            try {
              return {
                known: true as const,
                event: await webhooks.validateEvent(raw, Object.fromEntries(headers), secret),
              };
            } catch (error) {
              if (error instanceof webhooks.PolarWebhookUnknownTypeError) {
                return { known: false as const, type: error.eventType };
              }
              throw error;
            }
          },
          catch: verificationError,
        });
        if (!outcome.known) {
          return { id: eventId, type: outcome.type ?? "unknown", resource: null };
        }
        const account = polarAccountId(outcome.event.data);
        if (account !== null && account !== options.accountId) {
          return yield* Effect.fail(
            billingFailure("Signature", "webhook-account-mismatch", "polar"),
          );
        }
        const kind = polarEventKind(outcome.event.type);
        if (kind === null) return { id: eventId, type: outcome.event.type, resource: null };
        const id = polarResourceId(outcome.event.data);
        if (id === null)
          return yield* Effect.fail(
            billingFailure("Provider", "webhook-resource-unmapped", "polar"),
          );
        return { id: eventId, type: outcome.event.type, resource: { kind, id } };
      }),

    /**
     * Polar 2026-10 has no dispute webhook events, so disputes are
     * retrieval-only; the helper scans every dispute page and fails closed on
     * overflow. Child and parent must share the same customer and account.
     */
    retrieve: makePolarRetrieve(sdkClient, options.accountId),
  };
};
