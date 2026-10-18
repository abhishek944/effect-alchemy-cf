import { Effect, Schema } from "effect";
import { billingError, type BillingError, type ResourceKind } from "./billing.ts";

/**
 * Dodo 2.54.2 webhook envelopes carry `business_id`, `type` and `data` but no
 * event id, so callers deduplicate on the standard-webhooks `webhook-id` header.
 */
export const DodoEnvelope = Schema.Struct({
  business_id: Schema.String,
  type: Schema.String,
  data: Schema.Unknown,
});

const paymentEvents = [
  "payment.succeeded",
  "payment.failed",
  "payment.processing",
  "payment.cancelled",
];
const refundEvents = ["refund.succeeded", "refund.failed"];
const disputeEvents = [
  "dispute.opened",
  "dispute.expired",
  "dispute.accepted",
  "dispute.cancelled",
  "dispute.challenged",
  "dispute.won",
  "dispute.lost",
];
const subscriptionEvents = [
  "subscription.active",
  "subscription.renewed",
  "subscription.on_hold",
  "subscription.past_due",
  "subscription.paused",
  "subscription.unpaused",
  "subscription.cancelled",
  "subscription.failed",
  "subscription.expired",
  "subscription.plan_changed",
  "subscription.updated",
  "subscription.update_payment_method",
];

/** Signed types with no billing resource (payouts, credits, licenses) stay unmapped. */
const eventKinds: Record<string, ResourceKind> = Object.fromEntries([
  ...paymentEvents.map((type) => [type, "purchase"] as const),
  ...refundEvents.map((type) => [type, "refund"] as const),
  ...disputeEvents.map((type) => [type, "dispute"] as const),
  ...subscriptionEvents.map((type) => [type, "subscription"] as const),
]);

export const dodoEventKind = (type: string): ResourceKind | null => eventKinds[type] ?? null;

const idFields = {
  purchase: "payment_id",
  refund: "refund_id",
  dispute: "dispute_id",
  subscription: "subscription_id",
} as const;

const DodoResourceData = Schema.Struct({
  payment_id: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  refund_id: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  dispute_id: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  subscription_id: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
});

/**
 * A known signed type must still carry its resource id. Decode failures become
 * Provider so the event stays retryable and visible instead of being dropped.
 */
export const dodoResourceId = (
  kind: ResourceKind,
  data: unknown,
): Effect.Effect<string | null, BillingError> =>
  Schema.decodeUnknownEffect(DodoResourceData)(data).pipe(
    Effect.map((decoded) => decoded[idFields[kind]] ?? null),
    Effect.mapError(() => billingError("Provider")),
  );
