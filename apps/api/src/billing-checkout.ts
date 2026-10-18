import {
  checkoutForRequest,
  customerForUser,
  decodeSnapshot,
  type CheckoutRow,
} from "@starter/auth/billing-data";
import { withBillingLease } from "@starter/auth/billing-lease";
import { billingKey, billingQuery } from "@starter/auth/billing-store";
import {
  completeCheckout,
  reserveCheckout,
  reserveCustomer,
  saveCustomer,
} from "@starter/auth/billing-writes";
import { billingError, type ProviderId } from "@starter/integrations/billing";
import { Effect } from "effect";
import { BillingRuntime, scopeById, type BillingScope } from "./billing-config.ts";
import type { User } from "./model.ts";

export const hostedBillingUrl = (provider: ProviderId, value: string) =>
  Effect.try({
    try: () => {
      const url = new URL(value);
      const domain = provider === "dodo" ? "dodopayments.com" : "polar.sh";
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !(url.hostname === domain || url.hostname.endsWith(`.${domain}`))
      )
        throw new Error();
      return url.href;
    },
    catch: () => billingError("Provider"),
  });

const savedCheckout = (row: CheckoutRow, slug: string) =>
  Effect.gen(function* () {
    if (row.slug !== slug) return yield* Effect.fail(billingError("Conflict"));
    const entry = yield* scopeById(row.scope);
    if (row.state !== "ready" || !row.sessionId || !row.url) {
      return yield* Effect.fail(billingError("UnknownOutcome"));
    }
    return { id: row.sessionId, url: yield* hostedBillingUrl(entry.provider, row.url) };
  });

const requireNoSubscription = (userId: string) =>
  Effect.gen(function* () {
    const pending = yield* billingQuery((db) =>
      db
        .prepare(
          "SELECT id FROM billing_checkout WHERE userId=? AND kind='subscription' AND resolution='pending' LIMIT 1",
        )
        .bind(userId)
        .first<{ id: string }>(),
    );
    if (pending !== null) return yield* Effect.fail(billingError("Conflict"));
    const rows = yield* billingQuery(async (db) => {
      const result = await db
        .prepare("SELECT * FROM billing_resource WHERE userId=? AND kind='subscription' LIMIT 101")
        .bind(userId)
        .all<Parameters<typeof decodeSnapshot>[0]>();
      return result.results.map(decodeSnapshot);
    });
    const terminal = ["cancelled", "canceled", "expired", "failed", "unpaid", "incomplete_expired"];
    if (
      rows.length > 100 ||
      rows.some(
        ({ resource }) => resource.accessState === "active" || !terminal.includes(resource.status),
      )
    ) {
      return yield* Effect.fail(billingError("Conflict"));
    }
    return undefined;
  });

const resolveCustomer = (entry: BillingScope, user: typeof User.Type) =>
  Effect.gen(function* () {
    const row = yield* customerForUser(entry.scope, user.id);
    if (row?.customerId) return row.customerId;
    const key = yield* billingKey(entry.scope, user.id);
    return { key, row };
  });

export const startBillingCheckout = (
  user: typeof User.Type,
  slug: string,
  requestId: string,
  origin: string,
) =>
  Effect.gen(function* () {
    const prior = yield* checkoutForRequest(user.id, requestId);
    if (prior !== null) return yield* savedCheckout(prior, slug);
    const runtime = yield* BillingRuntime;
    const entry = runtime.scopes.find((scope) => scope.provider === runtime.defaultProvider);
    const product = runtime.products[slug];
    if (!entry || !product?.[entry.provider])
      return yield* Effect.fail(billingError("InvalidInput"));
    const productId = product[entry.provider];
    if (productId === undefined) return yield* Effect.fail(billingError("InvalidInput"));
    return yield* withBillingLease(entry.scope, (lease) =>
      Effect.gen(function* () {
        const repeated = yield* checkoutForRequest(user.id, requestId);
        if (repeated !== null) return yield* savedCheckout(repeated, slug);
        if (product.kind === "subscription") yield* requireNoSubscription(user.id);
        const unresolved = yield* billingQuery((db) =>
          db
            .prepare(
              "SELECT id FROM billing_checkout WHERE userId=? AND slug=? AND resolution='pending' LIMIT 1",
            )
            .bind(user.id, slug)
            .first<{ id: string }>(),
        );
        if (unresolved !== null) return yield* Effect.fail(billingError("Conflict"));
        const id = yield* billingKey(user.id, requestId);
        yield* reserveCheckout(lease, {
          id,
          userId: user.id,
          requestId,
          scope: entry.scope,
          slug,
          kind: product.kind,
          productId,
          customerId: null,
          state: "pending",
          sessionId: null,
          url: null,
          createdAt: 0,
        });
        const customer = yield* resolveCustomer(entry, user);
        let customerId: string;
        if (typeof customer === "string") customerId = customer;
        else {
          if (
            customer.row !== null &&
            (entry.provider === "dodo" || Date.now() / 1000 - customer.row.createdAt > 23 * 3600)
          ) {
            return yield* Effect.fail(billingError("UnknownOutcome"));
          }
          if (customer.row === null) yield* reserveCustomer(lease, customer.key, user.id);
          customerId = yield* entry.adapter.customer({
            ...user,
            userId: user.id,
            key: customer.key,
          });
          yield* saveCustomer(lease, customer.key, customerId);
        }
        const checkout = yield* entry.adapter.checkout({
          customerId,
          productId,
          requestId: id,
          returnUrl: `${origin}/settings/account?billing=return`,
        });
        const url = yield* hostedBillingUrl(entry.provider, checkout.url);
        yield* completeCheckout(lease, id, customerId, checkout.id, url);
        return { id: checkout.id, url };
      }).pipe(
        Effect.timeout("20 seconds"),
        Effect.catchTag("TimeoutError", () => Effect.fail(billingError("UnknownOutcome"))),
      ),
    );
  });

export const openBillingPortal = (userId: string, scope: string, origin: string) =>
  Effect.gen(function* () {
    const customer = yield* customerForUser(scope, userId);
    if (!customer?.customerId) return yield* Effect.fail(billingError("NotFound"));
    const entry = yield* scopeById(scope);
    const url = yield* entry.adapter.portal({
      customerId: customer.customerId,
      returnUrl: `${origin}/settings/account`,
    });
    return { url: yield* hostedBillingUrl(entry.provider, url) };
  });
