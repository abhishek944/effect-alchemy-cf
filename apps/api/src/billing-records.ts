import { billingKey } from "@starter/auth/billing-store";
import {
  checkoutByKey,
  checkoutForSession,
  customerOwner,
  decodeSnapshot,
  pendingSubscriptionCheckout,
  purchaseForSubscription,
  resourceById,
  type ResourceRow,
} from "@starter/auth/billing-data";
import { withCause } from "@starter/diagnostics";
import {
  billingError,
  ProviderResource,
  StoredResource,
  type ProviderResource as Resource,
  type StoredResource as Snapshot,
} from "@starter/integrations/billing";
import { Effect, Schema } from "effect";
import { BillingRuntime } from "./billing-config.ts";

export const readSnapshot = (row: ResourceRow) =>
  Effect.try({
    try: () => decodeSnapshot(row),
    catch: (cause) => withCause(billingError("Storage"), cause),
  });

export const billingAccess = (snapshot: Snapshot, syncedAt: number, now = Date.now() / 1000) => {
  const resource = snapshot.resource;
  const stale = now - syncedAt > 86400 || syncedAt > now + 60;
  const paid = resource.accessState === "active" && !resource.disputed;
  const fullRefund =
    resource.amount !== null && resource.amount > 0 && resource.refundedAmount >= resource.amount;
  const periodEnd = resource.periodEnd === null ? NaN : Date.parse(resource.periodEnd) / 1000;
  const expectedKind = resource.kind === "subscription" ? "subscription" : "one_time";
  const entitled = snapshot.entitlements.some((item) => item.kind === expectedKind);
  const access =
    !stale &&
    paid &&
    entitled &&
    (resource.kind === "subscription"
      ? periodEnd > now
      : resource.kind === "purchase" && resource.subscriptionId === null && !fullRefund);
  return { stale, access };
};

/** Immutable product associations prefer original checkout and saved snapshots. */
export const prepareBillingRows = (scope: string, input: readonly Resource[]) =>
  Effect.gen(function* () {
    const runtime = yield* BillingRuntime;
    const resources = yield* Schema.decodeUnknownEffect(
      Schema.Array(ProviderResource).check(Schema.isMaxLength(10)),
    )(input).pipe(Effect.mapError((cause) => withCause(billingError("Provider"), cause)));
    if (resources.length === 0) return yield* Effect.fail(billingError("Provider"));
    const rows: ResourceRow[] = [];
    for (const resource of resources) {
      const owner = yield* customerOwner(scope, resource.customerId);
      if (owner === null) return yield* Effect.fail(billingError("Unmapped"));
      const old = yield* resourceById(scope, resource.kind, resource.id);
      if (old !== null && (old.userId !== owner.userId || old.customerId !== resource.customerId)) {
        return yield* Effect.fail(billingError("Unmapped"));
      }
      const previous = old === null ? [] : (yield* readSnapshot(old)).entitlements;
      const purchase =
        resource.kind === "subscription"
          ? yield* purchaseForSubscription(scope, resource.id)
          : resource.purchaseId === null
            ? null
            : yield* resourceById(scope, "purchase", resource.purchaseId);
      if (purchase !== null && purchase.userId !== owner.userId)
        return yield* Effect.fail(billingError("Unmapped"));
      const linked = purchase === null ? null : yield* readSnapshot(purchase);
      const requestKey = resource.requestKey ?? linked?.resource.requestKey;
      const checkoutId = resource.checkoutId ?? linked?.resource.checkoutId;
      const checkout = requestKey
        ? yield* checkoutByKey(requestKey)
        : checkoutId
          ? yield* checkoutForSession(scope, checkoutId)
          : null;
      if (
        checkout !== null &&
        (checkout.scope !== scope ||
          checkout.userId !== owner.userId ||
          (checkout.customerId !== null && checkout.customerId !== resource.customerId))
      ) {
        return yield* Effect.fail(billingError("Unmapped"));
      }
      if (
        old === null &&
        resource.kind === "subscription" &&
        checkout === null &&
        resource.productId !== null &&
        (yield* pendingSubscriptionCheckout(scope, owner.userId, resource.productId)) !== null
      ) {
        return yield* Effect.fail(billingError("Unmapped"));
      }
      const subscription =
        resource.subscriptionId === null
          ? null
          : yield* resourceById(scope, "subscription", resource.subscriptionId);
      if (
        subscription !== null &&
        (subscription.userId !== owner.userId || subscription.customerId !== resource.customerId)
      )
        return yield* Effect.fail(billingError("Unmapped"));
      const inherited =
        subscription === null ? [] : (yield* readSnapshot(subscription)).entitlements;
      const ids = new Set(resource.products.map((product) => product.id));
      if (resource.productId !== null) ids.add(resource.productId);
      const provider = runtime.scopes.find((entry) => entry.scope === scope)?.provider;
      const entitlements: Snapshot["entitlements"][number][] = [];
      for (const id of ids) {
        const saved = [...previous, ...inherited, ...(linked?.entitlements ?? [])].find(
          (item) => item.productId === id,
        );
        const product =
          provider === undefined
            ? undefined
            : Object.entries(runtime.products).find(([, value]) => value[provider] === id);
        const found =
          saved ??
          (checkout?.productId === id
            ? {
                slug: checkout.slug,
                kind: checkout.kind,
                productId: id,
              }
            : product
              ? { slug: product[0], kind: product[1].kind, productId: id }
              : undefined);
        if (found) entitlements.push(found);
      }
      const snapshot = yield* Schema.decodeUnknownEffect(StoredResource)({
        resource,
        entitlements,
      }).pipe(Effect.mapError((cause) => withCause(billingError("Provider"), cause)));
      rows.push({
        id: yield* billingKey(scope, resource.kind, resource.id),
        scope,
        kind: resource.kind,
        providerId: resource.id,
        userId: owner.userId,
        customerId: resource.customerId,
        data: JSON.stringify(snapshot),
        syncedAt: Date.now() / 1000,
        ...(checkout !== null &&
        ((resource.kind === "subscription" && checkout.kind === "subscription") ||
          (resource.kind === "purchase" &&
            checkout.kind === "one_time" &&
            resource.subscriptionId === null &&
            (resource.accessState === "active" ||
              ["succeeded", "paid", "refunded", "partially_refunded"].includes(resource.status))))
          ? { checkoutKey: checkout.id }
          : {}),
      });
    }
    return rows;
  });
