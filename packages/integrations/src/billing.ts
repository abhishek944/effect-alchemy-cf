import { Schema, type Effect, type Redacted } from "effect";

export const BillingProviderId = Schema.Literals(["dodo", "polar"]);
export type ProviderId = typeof BillingProviderId.Type;
export const ResourceKind = Schema.Literals(["subscription", "purchase", "refund", "dispute"]);
export type ResourceKind = typeof ResourceKind.Type;
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Amount = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export const ResourceReference = Schema.Struct({ kind: ResourceKind, id: Id });
export type ResourceReference = typeof ResourceReference.Type;
export const EventReference = Schema.Struct({
  id: Id,
  type: Id,
  resource: Schema.NullOr(ResourceReference),
});
export type EventReference = typeof EventReference.Type;
export const ProviderResource = Schema.Struct({
  kind: ResourceKind,
  id: Id,
  customerId: Id,
  productId: Schema.NullOr(Id),
  status: Id,
  subscriptionId: Schema.NullOr(Id),
  purchaseId: Schema.NullOr(Id),
  checkoutId: Schema.NullOr(Id),
  requestKey: Schema.NullOr(Id),
  amount: Schema.NullOr(Amount),
  currency: Schema.NullOr(Schema.String),
  periodEnd: Schema.NullOr(Schema.String),
  cancelAtPeriodEnd: Schema.Boolean,
  accessState: Schema.Literals(["active", "inactive"]),
  refundedAmount: Amount,
  disputed: Schema.Boolean,
  products: Schema.Array(Schema.Struct({ id: Id, quantity: Amount })).check(Schema.isMaxLength(20)),
});
export type ProviderResource = typeof ProviderResource.Type;
export class BillingError extends Schema.TaggedError<BillingError>()("BillingError", {
  kind: Schema.Literals([
    "Configuration",
    "InvalidInput",
    "Signature",
    "Provider",
    "Storage",
    "Busy",
    "Unmapped",
    "NotFound",
    "Conflict",
    "UnknownOutcome",
  ]),
}) {}
export const billingError = (kind: BillingError["kind"]) => new BillingError({ kind });

export interface ProviderOptions {
  readonly apiKey: Redacted.Redacted;
  readonly webhookSecret: Redacted.Redacted;
  readonly accountId: string;
  readonly live: boolean;
}
export interface BillingAdapter {
  readonly id: ProviderId;
  customer(input: {
    userId: string;
    name: string;
    email: string;
    key: string;
  }): Effect.Effect<string, BillingError>;
  checkout(input: {
    customerId: string;
    productId: string;
    requestId: string;
    returnUrl: string;
  }): Effect.Effect<{ id: string; url: string }, BillingError>;
  portal(input: { customerId: string; returnUrl: string }): Effect.Effect<string, BillingError>;
  verify(raw: string, headers: Headers): Effect.Effect<EventReference, BillingError>;
  retrieve(reference: ResourceReference): Effect.Effect<readonly ProviderResource[], BillingError>;
}

export const ProductKind = Schema.Literals(["subscription", "one_time"]);
export const BillingProduct = Schema.Struct({
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  kind: ProductKind,
  dodo: Schema.optional(Id),
  polar: Schema.optional(Id),
});
export const BillingProducts = Schema.Record(
  Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/)),
  BillingProduct,
);
export type BillingProducts = typeof BillingProducts.Type;
export const Entitlement = Schema.Struct({
  slug: Schema.String,
  kind: ProductKind,
  productId: Id,
});
export const StoredResource = Schema.Struct({
  resource: ProviderResource,
  entitlements: Schema.Array(Entitlement),
});
export type StoredResource = typeof StoredResource.Type;
export const BillingView = Schema.Struct({
  enabled: Schema.Boolean,
  defaultProvider: Schema.NullOr(BillingProviderId),
  products: Schema.Array(
    Schema.Struct({ slug: Schema.String, label: Schema.String, kind: ProductKind }),
  ),
  customers: Schema.Array(Schema.Struct({ scope: Schema.String, provider: BillingProviderId })),
  resources: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      scope: Schema.String,
      provider: BillingProviderId,
      snapshot: StoredResource,
      syncedAt: Schema.Number,
      stale: Schema.Boolean,
      access: Schema.Boolean,
    }),
  ),
});
export type BillingView = typeof BillingView.Type;
