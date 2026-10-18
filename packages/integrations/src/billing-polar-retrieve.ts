import { Effect } from "effect";
import type { models } from "@polar-sh/sdk/2026-10";
import {
  billingError,
  type BillingError,
  type ProviderResource,
  type ResourceReference,
} from "./billing.ts";
import type { PolarSdk } from "./billing-polar-client.ts";
import {
  polarDispute,
  polarPurchase,
  polarRefund,
  polarSubscription,
} from "./billing-polar-normalize.ts";

/**
 * Polar 2026-10 publishes no dispute webhook events, so disputes are
 * retrieval-only. Every dispute page for the order is scanned because one
 * historical win must not hide a newer open dispute, and an order needing more
 * pages than the bound fails closed instead of being reported as undisputed.
 */
const PAGE_LIMIT = 100;
const PAGE_MAX = 5;

/** Statuses that currently hold access; `prevented` and `won` are closed and favorable. */
const holdingDisputes = new Set<models.DisputeStatus>([
  "early_warning",
  "needs_response",
  "under_review",
  "lost",
]);

const ownedBy = (organizationId: string, accountId: string) =>
  organizationId === accountId ? Effect.void : Effect.fail(billingError("Configuration"));

const sameCustomer = (child: string, parent: string) =>
  child === parent ? Effect.void : Effect.fail(billingError("Provider"));

export type PolarRetrieve = (
  reference: ResourceReference,
) => Effect.Effect<readonly ProviderResource[], BillingError>;

export const makePolarRetrieve = (sdk: PolarSdk, accountId: string): PolarRetrieve => {
  const { client: connect, call } = sdk;

  return (reference) =>
    Effect.gen(function* () {
      const client = yield* connect;

      const disputeHold = (orderId: string): Effect.Effect<boolean, BillingError> =>
        Effect.gen(function* () {
          for (let page = 1; page <= PAGE_MAX; page += 1) {
            const result = yield* call(
              () => client.disputes.list({ order_id: orderId, limit: PAGE_LIMIT, page }),
              "definite",
            );
            if (result.items.some((dispute) => holdingDisputes.has(dispute.status))) return true;
            if (result.pagination.max_page > PAGE_MAX) {
              return yield* Effect.fail(billingError("Provider"));
            }
            if (page >= result.pagination.max_page) return false;
          }
          return yield* Effect.fail(billingError("Provider"));
        });

      const purchaseOf = (orderId: string): Effect.Effect<ProviderResource, BillingError> =>
        Effect.gen(function* () {
          const order = yield* call(() => client.orders.get(orderId), "definite");
          yield* ownedBy(order.customer.organization_id, accountId);
          return polarPurchase(order, yield* disputeHold(orderId));
        });

      switch (reference.kind) {
        case "subscription": {
          const subscription = yield* call(
            () => client.subscriptions.get(reference.id),
            "definite",
          );
          yield* ownedBy(subscription.customer.organization_id, accountId);
          return [polarSubscription(subscription)];
        }
        case "purchase": {
          const purchase = yield* purchaseOf(reference.id);
          return [purchase];
        }
        case "refund": {
          // 2026-10 has no refunds.get, so filter the list by id instead.
          const page = yield* call(
            () => client.refunds.list({ id: [reference.id], limit: 1 }),
            "definite",
          );
          const refund = page.items[0];
          if (refund === undefined) return yield* Effect.fail(billingError("NotFound"));
          yield* ownedBy(refund.organization_id, accountId);
          const purchase = yield* purchaseOf(refund.order_id);
          yield* sameCustomer(refund.customer_id, purchase.customerId);
          const disputed = refund.dispute !== null && holdingDisputes.has(refund.dispute.status);
          return [polarRefund(refund, purchase, disputed), purchase];
        }
        case "dispute": {
          const dispute = yield* call(() => client.disputes.get(reference.id), "definite");
          yield* ownedBy(dispute.customer.organization_id, accountId);
          const purchase = yield* purchaseOf(dispute.order_id);
          yield* sameCustomer(dispute.customer.id, purchase.customerId);
          return [polarDispute(dispute, purchase, holdingDisputes.has(dispute.status)), purchase];
        }
        default:
          return yield* Effect.fail(billingError("InvalidInput"));
      }
    });
};
