import type { BillingError, StoredResource } from "@starter/integrations/billing";
import { Context, Layer, type Effect } from "effect";

export type BillingSync = {
  readonly eventKey: string;
  readonly eventType: string;
  readonly scope: string;
  readonly snapshots: readonly StoredResource[];
};

/** Optional application fulfillment. Keep external actions idempotent by financial object/action. */
export class BillingHooks extends Context.Service<
  BillingHooks,
  {
    readonly afterSync: ((input: BillingSync) => Effect.Effect<void, BillingError>) | null;
  }
>()("starter/BillingHooks") {
  // Replace null with an application-owned Effect; no shipping/credit/license policy is assumed.
  static readonly layer = Layer.succeed(BillingHooks, { afterSync: null });
}
