import { eventByKey, recordEvent, resourceByKey } from "@starter/auth/billing-data";
import { withBillingLease } from "@starter/auth/billing-lease";
import { billingKey } from "@starter/auth/billing-store";
import { claimEvent, failEvent, saveResources } from "@starter/auth/billing-writes";
import {
  reportedFailure,
  reportEventEffect,
  reportFailureEffect,
  withCause,
} from "@starter/diagnostics";
import {
  billingError,
  billingFailure,
  ResourceReference,
  EventReference,
} from "@starter/integrations/billing";
import { Effect, Schema } from "effect";
import { scopeById, type BillingScope } from "./billing-config.ts";
import { billingDeadline, type BillingPhase } from "./billing-deadline.ts";
import { BillingHooks } from "./billing-hooks.ts";
import { prepareBillingRows, readSnapshot } from "./billing-records.ts";
import { reportBillingFailureEffect } from "./billing-report.ts";

export const processBillingEvent = (key: string) =>
  Effect.gen(function* () {
    const event = yield* eventByKey(key);
    if (event === null) return yield* Effect.fail(billingFailure("NotFound", "event-missing"));
    if (event.state === "completed") return undefined;
    const entry = yield* scopeById(event.scope);
    return yield* withBillingLease(entry.scope, (lease) =>
      Effect.gen(function* () {
        const current = yield* eventByKey(key);
        if (current?.state === "completed") return undefined;
        yield* claimEvent(lease, key);
        // Fiber-local phase marker: names the dependency pending when the deadline fires.
        let phase: BillingPhase = "decode";
        yield* Effect.gen(function* () {
          const reference = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(Schema.NullOr(ResourceReference)),
          )(event.reference).pipe(
            Effect.mapError((cause) => withCause(billingError("Storage"), cause)),
          );
          phase = "retrieve";
          const resources = reference === null ? [] : yield* entry.adapter.retrieve(reference);
          phase = "prepare";
          const rows = reference === null ? [] : yield* prepareBillingRows(entry.scope, resources);
          const hooks = yield* BillingHooks;
          if (hooks.afterSync !== null && reference !== null) {
            phase = "save";
            yield* saveResources(lease, rows, key, false);
            phase = "snapshot";
            const snapshots = yield* Effect.forEach(rows, readSnapshot);
            phase = "hook";
            yield* hooks
              .afterSync({ eventKey: key, eventType: event.type, scope: entry.scope, snapshots })
              .pipe(
                Effect.catchDefect((defect) =>
                  Effect.fail(withCause(billingError("Provider"), defect)),
                ),
              );
            phase = "finalize";
            yield* saveResources(lease, [], key);
          } else {
            phase = "finalize";
            yield* saveResources(lease, rows, key);
          }
        }).pipe(
          billingDeadline({
            duration: "7 seconds",
            kind: "Provider",
            phase: () => phase,
            provider: entry.provider,
          }),
          Effect.catch((error) =>
            failEvent(key, lease.token, error.kind).pipe(
              // Primary outcome still propagates; failed bookkeeping is reported, never retried.
              Effect.tap((result) =>
                result.meta.changes === 0
                  ? reportEventEffect({
                      component: "billing",
                      operation: "billing.event.fail",
                      phase: "bookkeeping",
                      reason: "event-fail-not-applied",
                      eventId: key,
                      outcome: "unknown",
                    })
                  : Effect.void,
              ),
              Effect.catch((bookkeeping) =>
                reportFailureEffect(bookkeeping, {
                  component: "billing",
                  operation: "billing.event.fail",
                  phase: "bookkeeping",
                  eventId: key,
                }),
              ),
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
      Effect.mapError(() => billingFailure("InvalidInput", "event-reference-invalid")),
    );
    const key = yield* billingKey(entry.scope, verified.id);
    // Once verified, the derived inbox key and finite provider are safe associations.
    return yield* Effect.gen(function* () {
      yield* recordEvent(key, entry.scope, verified);
      yield* processBillingEvent(key);
    }).pipe(
      Effect.catch((error) =>
        reportBillingFailureEffect("billing.webhook.receive", error, {
          provider: entry.provider,
          eventId: key,
        }).pipe(Effect.andThen(Effect.fail(reportedFailure(error)))),
      ),
    );
  });

export const refreshBillingResource = (key: string, userId?: string) =>
  Effect.gen(function* () {
    const row = yield* resourceByKey(key);
    if (row === null || (userId !== undefined && row.userId !== userId)) {
      return yield* Effect.fail(billingFailure("NotFound", "resource-missing"));
    }
    const entry = yield* scopeById(row.scope);
    return yield* withBillingLease(entry.scope, (lease) =>
      Effect.gen(function* () {
        let phase: BillingPhase = "retrieve";
        yield* entry.adapter
          .retrieve({
            kind: row.kind,
            id: row.providerId,
          })
          .pipe(
            Effect.flatMap((resources) => {
              phase = "prepare";
              return prepareBillingRows(entry.scope, resources);
            }),
            Effect.flatMap((rows) => {
              phase = "save";
              return saveResources(lease, rows);
            }),
            billingDeadline({
              duration: "7 seconds",
              kind: "Provider",
              phase: () => phase,
              provider: entry.provider,
            }),
          );
        return undefined;
      }),
    );
  });
