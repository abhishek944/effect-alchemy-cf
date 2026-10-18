import { Option, Schema } from "effect";
import type { models } from "@polar-sh/sdk/2026-10";
import type { ProviderResource, ResourceKind } from "./billing.ts";

/**
 * Polar 2026-10 publishes no dispute webhook events, so only subscription, order
 * and refund types map to resources. Disputes stay retrieval-only.
 */
const eventKinds: Record<string, ResourceKind> = {
  "subscription.created": "subscription",
  "subscription.updated": "subscription",
  "subscription.active": "subscription",
  "subscription.canceled": "subscription",
  "subscription.uncanceled": "subscription",
  "subscription.cycled": "subscription",
  "subscription.revoked": "subscription",
  "subscription.past_due": "subscription",
  "subscription.paused": "subscription",
  "subscription.resumed": "subscription",
  "subscription.migrated": "subscription",
  "order.created": "purchase",
  "order.updated": "purchase",
  "order.paid": "purchase",
  "order.refunded": "purchase",
  "refund.created": "refund",
  "refund.updated": "refund",
};

export const polarEventKind = (type: string): ResourceKind | null => eventKinds[type] ?? null;

/**
 * Verified payloads carry no top-level account id, so read it from the resource
 * itself or from the nested customer or product. Absent ids skip the check.
 */
const PolarIds = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  organization_id: Schema.optional(Schema.NullOr(Schema.String)),
  customer: Schema.optional(
    Schema.Struct({ organization_id: Schema.optional(Schema.NullOr(Schema.String)) }),
  ),
  product: Schema.optional(
    Schema.Struct({ organization_id: Schema.optional(Schema.NullOr(Schema.String)) }),
  ),
});

const decodeIds = (data: unknown) => Option.getOrNull(Schema.decodeUnknownOption(PolarIds)(data));

export const polarAccountId = (data: unknown): string | null => {
  const ids = decodeIds(data);
  if (ids === null) return null;
  return (
    ids.organization_id ?? ids.customer?.organization_id ?? ids.product?.organization_id ?? null
  );
};

/** Every mapped payload carries the resource id at `data.id`. */
export const polarResourceId = (data: unknown): string | null => {
  const id = decodeIds(data)?.id;
  return id === undefined || id === "" ? null : id;
};

/** Server metadata correlates the logical checkout attempt; it never proves ownership. */
const requestKey = (metadata: Record<string, string | number | boolean>): string | null => {
  const value = metadata["request_key"];
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
};

/** Provider minor units; non-finite and negative values normalize to zero. */
const money = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;

export const polarSubscription = (subscription: models.Subscription): ProviderResource => ({
  kind: "subscription",
  id: subscription.id,
  customerId: subscription.customer_id,
  productId: subscription.product_id,
  status: subscription.status,
  subscriptionId: null,
  purchaseId: null,
  checkoutId: subscription.checkout_id ?? null,
  requestKey: requestKey(subscription.metadata),
  amount: money(subscription.amount),
  currency: subscription.currency,
  periodEnd: subscription.current_period_end,
  cancelAtPeriodEnd: subscription.cancel_at_period_end,
  accessState:
    subscription.status === "active" || subscription.status === "trialing" ? "active" : "inactive",
  refundedAmount: 0,
  disputed: false,
  products: [],
});

/**
 * Polar 2026-10 order items expose no product id or quantity, so product lines
 * stay empty and `productId` carries the entitlement key. The caller flags a
 * disputed order after listing that order's disputes, and a `refunded` status
 * always revokes access regardless of the amounts.
 */
export const polarPurchase = (order: models.Order, disputed: boolean): ProviderResource => {
  const total = money(order.total_amount);
  // `refunded_amount` excludes tax, while `total_amount` is tax-inclusive.
  const refundedAmount = money(order.refunded_amount) + money(order.refunded_tax_amount);
  const fullyRefunded = order.status === "refunded" || (total > 0 && refundedAmount >= total);
  return {
    kind: "purchase",
    id: order.id,
    customerId: order.customer_id,
    productId: order.product_id,
    status: order.status,
    subscriptionId: order.subscription_id,
    purchaseId: null,
    checkoutId: order.checkout_id ?? null,
    requestKey: requestKey(order.metadata),
    amount: total,
    currency: order.currency,
    periodEnd: null,
    cancelAtPeriodEnd: false,
    accessState: order.paid && !disputed && !fullyRefunded ? "active" : "inactive",
    refundedAmount,
    disputed,
    products: [],
  };
};

/** Refunds keep the parent order id; product context comes from the parent. */
export const polarRefund = (
  refund: models.Refund,
  parent: ProviderResource,
  disputed: boolean,
): ProviderResource => ({
  kind: "refund",
  id: refund.id,
  customerId: refund.customer_id,
  productId: parent.productId,
  status: refund.status,
  subscriptionId: refund.subscription_id,
  purchaseId: refund.order_id,
  checkoutId: null,
  requestKey: null,
  amount: money(refund.amount),
  currency: refund.currency,
  periodEnd: null,
  cancelAtPeriodEnd: false,
  accessState: "inactive",
  refundedAmount: refund.status === "succeeded" ? money(refund.amount) : 0,
  disputed,
  products: [],
});

export const polarDispute = (
  dispute: models.Dispute,
  parent: ProviderResource,
  disputed: boolean,
): ProviderResource => ({
  kind: "dispute",
  id: dispute.id,
  customerId: dispute.customer.id,
  productId: parent.productId,
  status: dispute.status,
  subscriptionId: null,
  purchaseId: dispute.order_id,
  checkoutId: null,
  requestKey: null,
  amount: money(dispute.amount),
  currency: dispute.currency,
  periodEnd: null,
  cancelAtPeriodEnd: false,
  accessState: "inactive",
  refundedAmount: 0,
  disputed,
  products: [],
});
