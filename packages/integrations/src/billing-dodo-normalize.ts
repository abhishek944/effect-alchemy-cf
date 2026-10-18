import type { GetDispute, Payment, Refund, Subscription } from "dodopayments/resources";
import type { ProviderResource } from "./billing.ts";

/** Server metadata correlates the logical checkout attempt; it never proves ownership. */
const requestKey = (metadata: Record<string, string | number | boolean>): string | null => {
  const value = metadata["request_key"];
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
};

/** Provider minor units; non-finite and negative values normalize to zero. */
const money = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;

const parseAmount = (value: string): number | null => {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

/**
 * Product lines are never truncated: the parent schema rejects more than twenty
 * lines so financial overflow stays visible instead of being silently omitted.
 */
const productLines = (
  cart: readonly { product_id: string; quantity: number }[] | null | undefined,
): ProviderResource["products"] =>
  (cart ?? []).map((line) => ({ id: line.product_id, quantity: money(line.quantity) }));

const successfulRefunds = (payment: Payment): number =>
  payment.refunds
    .filter((refund) => refund.status === "succeeded")
    .reduce((sum, refund) => sum + money(refund.amount), 0);

/** Access ends at the earlier of the paid-through date and an explicit expiry. */
const periodEnd = (expires: string | null | undefined, next: string): string =>
  expires !== null && expires !== undefined && expires < next ? expires : next;

/**
 * A payment is one purchase. Subscription-linked payments stay inactive for the
 * parent to suppress; access is granted only for a succeeded, unrefunded,
 * undisputed payment so disputes and full refunds revoke conservatively. The
 * caller decides `disputed` from current dispute statuses, never from history.
 */
export const dodoPurchase = (payment: Payment, disputed: boolean): ProviderResource => {
  const total = money(payment.total_amount);
  const refunded = successfulRefunds(payment);
  const refundedAmount = payment.refund_status === "full" ? Math.max(refunded, total) : refunded;
  const fullyRefunded = total > 0 && refundedAmount >= total;
  return {
    kind: "purchase",
    id: payment.payment_id,
    customerId: payment.customer.customer_id,
    productId: payment.product_cart?.[0]?.product_id ?? null,
    status: payment.status ?? "unknown",
    subscriptionId: payment.subscription_id ?? payment.subscription_ids[0] ?? null,
    purchaseId: null,
    checkoutId: payment.checkout_session_id ?? null,
    requestKey: requestKey(payment.metadata),
    amount: total,
    currency: payment.currency,
    periodEnd: null,
    cancelAtPeriodEnd: false,
    accessState:
      payment.status === "succeeded" && !disputed && !fullyRefunded ? "active" : "inactive",
    refundedAmount,
    disputed,
    products: productLines(payment.product_cart),
  };
};

/**
 * Refunds keep the parent purchase id; product context comes from the parent.
 * Refunds carry no logical checkout attempt of their own, so `requestKey` stays
 * null and the parent correlates through the purchase.
 */
export const dodoRefund = (refund: Refund, parent: ProviderResource): ProviderResource => ({
  kind: "refund",
  id: refund.refund_id,
  customerId: refund.customer.customer_id,
  productId: parent.productId,
  status: refund.status,
  subscriptionId: null,
  purchaseId: refund.payment_id,
  checkoutId: null,
  requestKey: null,
  amount: refund.amount ?? null,
  currency: refund.currency ?? null,
  periodEnd: null,
  cancelAtPeriodEnd: false,
  accessState: "inactive",
  refundedAmount: refund.status === "succeeded" ? money(refund.amount) : 0,
  disputed: false,
  products: [],
});

/** Dodo reports dispute amounts as strings; unparsable values stay null. */
export const dodoDispute = (
  dispute: GetDispute,
  parent: ProviderResource,
  disputed: boolean,
): ProviderResource => ({
  kind: "dispute",
  id: dispute.dispute_id,
  customerId: dispute.customer.customer_id,
  productId: parent.productId,
  status: dispute.dispute_status,
  subscriptionId: null,
  purchaseId: dispute.payment_id,
  checkoutId: null,
  requestKey: null,
  amount: parseAmount(dispute.amount),
  currency: dispute.currency,
  periodEnd: null,
  cancelAtPeriodEnd: false,
  accessState: "inactive",
  refundedAmount: 0,
  disputed,
  products: [],
});

/** Dodo has no trialing status: trials report `active` with a trial amount. */
export const dodoSubscription = (subscription: Subscription): ProviderResource => ({
  kind: "subscription",
  id: subscription.subscription_id,
  customerId: subscription.customer.customer_id,
  productId: subscription.product_id,
  status: subscription.status,
  subscriptionId: null,
  purchaseId: null,
  checkoutId: null,
  requestKey: requestKey(subscription.metadata),
  amount: money(subscription.recurring_pre_tax_amount),
  currency: subscription.currency,
  periodEnd: periodEnd(subscription.expires_at, subscription.next_billing_date),
  cancelAtPeriodEnd: subscription.cancel_at_next_billing_date,
  accessState: subscription.status === "active" ? "active" : "inactive",
  refundedAmount: 0,
  disputed: false,
  products: [],
});
