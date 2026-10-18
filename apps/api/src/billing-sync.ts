import { eventByKey, recordEvent, resourceByKey } from "@starter/auth/billing-data";
import { withBillingLease } from "@starter/auth/billing-lease";
import { billingKey } from "@starter/auth/billing-store";
import { claimEvent, failEvent, saveResources } from "@starter/auth/billing-writes";
import { billingError, ResourceReference, EventReference } from "@starter/integrations/billing";
import { Effect, Schema } from "effect";
import { scopeById, type BillingScope } from "./billing-config.ts";
import { prepareBillingRows, readSnapshot } from "./billing-records.ts";
import { BillingHooks } from "./billing-hooks.ts";

export const processBillingEvent = (key: string) =>
  Effect.gen(function* () {
    const event = yield* eventByKey(key);
    if (event === null) return yield* Effect.fail(billingError("NotFound"));
    if (event.state === "completed") return undefined;
    const entry = yield* scopeById(event.scope);
    return yield* withBillingLease(entry.scope, (lease) =>
      Effect.gen(function* () {
        const current = yield* eventByKey(key);
        if (current?.state === "completed") return undefined;
        yield* claimEvent(lease, key);
        yield* Effect.gen(function* () {
          const reference = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(Schema.NullOr(ResourceReference)),
          )(event.reference).pipe(Effect.mapError(() => billingError("Storage")));
          const rows =
            reference === null
              ? []
              : yield* entry.adapter
                  .retrieve(reference)
                  .pipe(Effect.flatMap((resources) => prepareBillingRows(entry.scope, resources)));
          const hooks = yield* BillingHooks;
          if (hooks.afterSync !== null && reference !== null) {
            yield* saveResources(lease, rows, key, false);
            const snapshots = yield* Effect.forEach(rows, readSnapshot);
            yield* hooks
              .afterSync({ eventKey: key, eventType: event.type, scope: entry.scope, snapshots })
              .pipe(Effect.catchDefect(() => Effect.fail(billingError("Provider"))));
            yield* saveResources(lease, [], key);
          } else yield* saveResources(lease, rows, key);
        }).pipe(
          Effect.timeout("7 seconds"),
          Effect.catchTag("TimeoutError", () => Effect.fail(billingError("Provider"))),
          Effect.catch((error) =>
            failEvent(key, lease.token, error.kind).pipe(
              Effect.catch(() => Effect.void),
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        );
        return undefined;
      }),
    );
  });

export const receiveBillingEvent = (entry: BillingScope, event: EventReference) =>
  Effect.gen(function* () {
    const verified = yield* Schema.decodeUnknownEffect(EventReference)(event).pipe(
      Effect.mapError(() => billingError("InvalidInput")),
    );
    const key = yield* billingKey(entry.scope, verified.id);
    yield* recordEvent(key, entry.scope, verified);
    yield* processBillingEvent(key);
  });

export const refreshBillingResource = (key: string, userId?: string) =>
  Effect.gen(function* () {
    const row = yield* resourceByKey(key);
    if (row === null || (userId !== undefined && row.userId !== userId)) {
      return yield* Effect.fail(billingError("NotFound"));
    }
    const entry = yield* scopeById(row.scope);
    return yield* withBillingLease(entry.scope, (lease) =>
      entry.adapter
        .retrieve({
          kind: row.kind,
          id: row.providerId,
        })
        .pipe(
          Effect.flatMap((resources) => prepareBillingRows(entry.scope, resources)),
          Effect.flatMap((rows) => saveResources(lease, rows)),
          Effect.timeout("7 seconds"),
          Effect.catchTag("TimeoutError", () => Effect.fail(billingError("Provider"))),
        ),
    );
  });
