import { BillingProviderId, BillingView } from "@starter/integrations/billing";
import { Schema } from "effect";

export { BillingView };
export const BillingKey = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const BillingScopeId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
export const CheckoutCommand = Schema.Struct({
  slug: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/)),
  requestId: Schema.String.check(
    Schema.isPattern(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i),
  ),
});
export const CheckoutReceipt = Schema.Struct({ id: Schema.String, url: Schema.String });
export const PortalReceipt = Schema.Struct({ url: Schema.String });
export const BillingEventView = Schema.Struct({
  id: BillingKey,
  scope: BillingScopeId,
  type: Schema.String,
  state: Schema.String,
  attempts: Schema.Number,
  error: Schema.NullOr(Schema.String),
  updatedAt: Schema.Number,
});
export const ProviderPath = Schema.Struct({ provider: BillingProviderId });

export class BillingUnavailable extends Schema.TaggedError<BillingUnavailable>()(
  "BillingUnavailable",
  {},
  { httpApiStatus: 503 },
) {}
export class BillingInvalidInput extends Schema.TaggedError<BillingInvalidInput>()(
  "BillingInvalidInput",
  {},
  { httpApiStatus: 400 },
) {}
export class BillingConflict extends Schema.TaggedError<BillingConflict>()(
  "BillingConflict",
  {},
  { httpApiStatus: 409 },
) {}
export class BillingMissing extends Schema.TaggedError<BillingMissing>()(
  "BillingMissing",
  {},
  { httpApiStatus: 404 },
) {}
export class BillingForbidden extends Schema.TaggedError<BillingForbidden>()(
  "BillingForbidden",
  {},
  { httpApiStatus: 403 },
) {}
export const billingErrors = [
  BillingUnavailable,
  BillingInvalidInput,
  BillingConflict,
  BillingMissing,
  BillingForbidden,
];
