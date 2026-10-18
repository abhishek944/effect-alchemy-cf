import { Schema } from "effect";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Authentication } from "./authentication.ts";
import { AdminAuthentication } from "./admin-authentication.ts";
import {
  BillingEventView,
  BillingKey,
  BillingScopeId,
  BillingView,
  CheckoutCommand,
  CheckoutReceipt,
  PortalReceipt,
  billingErrors,
} from "./billing-model.ts";

export class BillingApi extends HttpApiGroup.make("billing")
  .add(
    HttpApiEndpoint.get("billingView", "/api/billing", {
      success: BillingView,
      error: billingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("billingCheckout", "/api/billing/checkout", {
      payload: CheckoutCommand,
      success: CheckoutReceipt,
      error: billingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("billingPortal", "/api/billing/portal", {
      payload: Schema.Struct({ scope: BillingScopeId }),
      success: PortalReceipt,
      error: billingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("billingRefresh", "/api/billing/refresh", {
      payload: Schema.Struct({ key: BillingKey }),
      success: Schema.Struct({ ok: Schema.Boolean }),
      error: billingErrors,
    }),
  )
  .middleware(Authentication) {}

export class BillingAdminApi extends HttpApiGroup.make("billingAdmin")
  .add(
    HttpApiEndpoint.get("billingEvents", "/api/admin/billing/events", {
      success: Schema.Struct({ events: Schema.Array(BillingEventView) }),
      error: billingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("billingReplay", "/api/admin/billing/replay", {
      payload: Schema.Struct({ key: BillingKey }),
      success: Schema.Struct({ ok: Schema.Boolean }),
      error: billingErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("billingAdminRefresh", "/api/admin/billing/refresh", {
      payload: Schema.Struct({ key: BillingKey }),
      success: Schema.Struct({ ok: Schema.Boolean }),
      error: billingErrors,
    }),
  )
  .middleware(AdminAuthentication) {}
