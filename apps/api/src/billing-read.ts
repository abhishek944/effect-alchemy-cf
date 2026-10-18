import { customersForUser, resourcesForUser } from "@starter/auth/billing-data";
import type { BillingView, ProviderId } from "@starter/integrations/billing";
import { Effect } from "effect";
import { BillingRuntime } from "./billing-config.ts";
import { billingAccess, readSnapshot } from "./billing-records.ts";

const providerForScope = (scope: string): ProviderId | null => {
  const provider = scope.split("/").at(-3);
  return provider === "dodo" || provider === "polar" ? provider : null;
};

export const readBillingView = (userId: string) =>
  Effect.gen(function* () {
    const runtime = yield* BillingRuntime;
    const customerRows = yield* customersForUser(userId);
    const rows = yield* resourcesForUser(userId);
    const resources: BillingView["resources"][number][] = [];
    for (const row of rows) {
      const provider = providerForScope(row.scope);
      if (provider === null) continue;
      const snapshot = yield* readSnapshot(row);
      resources.push({
        key: row.id,
        scope: row.scope,
        provider,
        snapshot,
        syncedAt: row.syncedAt,
        ...billingAccess(snapshot, row.syncedAt),
      });
    }
    return {
      enabled: runtime.defaultProvider !== null,
      defaultProvider: runtime.defaultProvider,
      products: Object.entries(runtime.products).flatMap(([slug, product]) =>
        runtime.defaultProvider !== null && product[runtime.defaultProvider]
          ? [{ slug, label: product.label, kind: product.kind }]
          : [],
      ),
      customers: customerRows.flatMap((row) => {
        const provider = providerForScope(row.scope);
        return provider === null ? [] : [{ scope: row.scope, provider }];
      }),
      resources,
    } satisfies BillingView;
  });
