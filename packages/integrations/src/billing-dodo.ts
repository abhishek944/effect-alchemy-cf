import { withCause } from "@starter/diagnostics";
import { Effect, Schema } from "effect";
import type { DisputeStatus } from "dodopayments/resources";
import {
  billingError,
  billingFailure,
  type BillingAdapter,
  type ProviderOptions,
} from "./billing.ts";
import { makeDodoSdk, printable, webhookError } from "./billing-dodo-client.ts";
import { DodoEnvelope, dodoEventKind, dodoResourceId } from "./billing-dodo-events.ts";
import {
  dodoDispute,
  dodoPurchase,
  dodoRefund,
  dodoSubscription,
} from "./billing-dodo-normalize.ts";

/**
 * Disputes that currently hold access. `dispute_won` and `dispute_cancelled`
 * are closed and favorable; every other status stays conservative, including
 * expired and lost disputes. History alone never revokes access.
 */
const holdingDisputes = new Set<DisputeStatus>([
  "dispute_opened",
  "dispute_expired",
  "dispute_accepted",
  "dispute_challenged",
  "dispute_lost",
]);

const disputeHolds = (disputes: readonly { dispute_status: DisputeStatus }[]): boolean =>
  disputes.some((dispute) => holdingDisputes.has(dispute.dispute_status));

const sameCustomer = (child: string, parent: string) =>
  child === parent ? Effect.void : Effect.fail(billingError("Provider"));

/**
 * Dodo adapter. Customers are created explicitly and reused by `customer_id`
 * because Dodo assigns ids server-side and has no external-id field; the parent
 * key travels in customer metadata for correlation only, never as proof.
 */
export const makeDodoBilling = (options: ProviderOptions): BillingAdapter => {
  const { client: sdk, call } = makeDodoSdk(options);
  const read = <A>(run: (signal: AbortSignal) => Promise<A>) => call(run, "definite");
  const ownedBy = (businessId: string) =>
    businessId === options.accountId ? Effect.void : Effect.fail(billingError("Configuration"));

  return {
    id: "dodo",

    customer: (input) =>
      Effect.gen(function* () {
        const client = yield* sdk;
        const created = yield* call(
          (signal) =>
            client.customers.create(
              {
                email: input.email,
                name: input.name.trim() === "" ? input.email : input.name,
                metadata: { billing_key: input.key },
              },
              { signal },
            ),
          "ambiguous",
        );
        return created.customer_id;
      }),

    checkout: (input) =>
      Effect.gen(function* () {
        const client = yield* sdk;
        const session = yield* call(
          (signal) =>
            client.checkoutSessions.create(
              {
                product_cart: [{ product_id: input.productId, quantity: 1 }],
                customer: { customer_id: input.customerId },
                return_url: input.returnUrl,
                metadata: { request_key: input.requestId },
              },
              { signal },
            ),
          "ambiguous",
        );
        const url = session.checkout_url;
        if (url === undefined || url === null) return yield* Effect.fail(billingError("Provider"));
        return { id: session.session_id, url };
      }),

    portal: (input) =>
      Effect.gen(function* () {
        const client = yield* sdk;
        const session = yield* call(
          (signal) =>
            client.customers.customerPortal.create(
              input.customerId,
              { return_url: input.returnUrl },
              { signal },
            ),
          "definite",
        );
        return session.link;
      }),

    /** The envelope has no event id, so the standard-webhooks header is the key. */
    verify: (raw, headers) =>
      Effect.gen(function* () {
        const client = yield* sdk;
        const eventId = headers.get("webhook-id");
        if (eventId === null || eventId === "")
          return yield* Effect.fail(billingFailure("Signature", "webhook-id-missing", "dodo"));
        const secret = printable(options.webhookSecret);
        if (secret === null)
          return yield* Effect.fail(
            billingFailure("Configuration", "webhook-secret-invalid", "dodo"),
          );
        const payload = yield* Effect.tryPromise({
          try: async () =>
            client.webhooks.unwrap(raw, { headers: Object.fromEntries(headers), key: secret }),
          catch: webhookError,
        });
        const envelope = yield* Schema.decodeUnknownEffect(DodoEnvelope)(payload).pipe(
          Effect.mapError((cause) =>
            withCause(billingFailure("Signature", "webhook-envelope-invalid", "dodo"), cause),
          ),
        );
        if (envelope.business_id !== options.accountId) {
          return yield* Effect.fail(
            billingFailure("Signature", "webhook-account-mismatch", "dodo"),
          );
        }
        const kind = dodoEventKind(envelope.type);
        if (kind === null) return { id: eventId, type: envelope.type, resource: null };
        const id = yield* dodoResourceId(kind, envelope.data);
        if (id === null)
          return yield* Effect.fail(
            billingFailure("Provider", "webhook-resource-unmapped", "dodo"),
          );
        return { id: eventId, type: envelope.type, resource: { kind, id } };
      }),

    /**
     * Refunds and disputes return the child first, then the hydrated purchase.
     * Child and parent must share the same customer, and retrieved business ids
     * must match the configured account where Dodo exposes them.
     */
    retrieve: (reference) =>
      Effect.gen(function* () {
        const client = yield* sdk;
        switch (reference.kind) {
          case "subscription": {
            const subscription = yield* read((signal) =>
              client.subscriptions.retrieve(reference.id, { signal }),
            );
            return [dodoSubscription(subscription)];
          }
          case "purchase": {
            const payment = yield* read((signal) =>
              client.payments.retrieve(reference.id, { signal }),
            );
            yield* ownedBy(payment.business_id);
            return [dodoPurchase(payment, disputeHolds(payment.disputes))];
          }
          case "refund": {
            const refund = yield* read((signal) =>
              client.refunds.retrieve(reference.id, { signal }),
            );
            const payment = yield* read((signal) =>
              client.payments.retrieve(refund.payment_id, { signal }),
            );
            yield* ownedBy(refund.business_id);
            yield* ownedBy(payment.business_id);
            yield* sameCustomer(refund.customer.customer_id, payment.customer.customer_id);
            const parent = dodoPurchase(payment, disputeHolds(payment.disputes));
            return [dodoRefund(refund, parent), parent];
          }
          case "dispute": {
            const dispute = yield* read((signal) =>
              client.disputes.retrieve(reference.id, { signal }),
            );
            const payment = yield* read((signal) =>
              client.payments.retrieve(dispute.payment_id, { signal }),
            );
            yield* ownedBy(dispute.business_id);
            yield* ownedBy(payment.business_id);
            yield* sameCustomer(dispute.customer.customer_id, payment.customer.customer_id);
            const parent = dodoPurchase(payment, disputeHolds(payment.disputes));
            return [
              dodoDispute(dispute, parent, holdingDisputes.has(dispute.dispute_status)),
              parent,
            ];
          }
          default:
            return yield* Effect.fail(billingError("InvalidInput"));
        }
      }),
  };
};
