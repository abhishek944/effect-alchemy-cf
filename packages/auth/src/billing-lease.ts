import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { reportFailureEffect } from "@starter/diagnostics";
import { billingFailure, type BillingError } from "@starter/integrations/billing";
import { Effect } from "effect";
import { billingQuery, DB_NOW } from "./billing-store.ts";

export type BillingLease = { scope: string; token: string };
export type BillingFence = { sql: string; args: [string, string, string] };

const acquire = (scope: string) =>
  Effect.gen(function* () {
    const token = crypto.randomUUID();
    const row = yield* billingQuery(
      (db) =>
        db
          .prepare(
            `INSERT INTO billing_lock (id, token, admittedToken, expiresAt)
     VALUES (?, ?, '', ${DB_NOW} + 30)
     ON CONFLICT(id) DO UPDATE SET token=excluded.token, admittedToken='', expiresAt=excluded.expiresAt
     WHERE billing_lock.expiresAt <= ${DB_NOW} RETURNING token`,
          )
          .bind(scope, token)
          .first<{ token: string }>(),
      "lease-acquire-write",
    );
    if (row?.token !== token) return yield* Effect.fail(billingFailure("Busy", "lease-contended"));
    return { scope, token };
  });

export const withBillingLease = <A, R>(
  scope: string,
  run: (lease: BillingLease) => Effect.Effect<A, BillingError, R>,
) =>
  Effect.gen(function* () {
    const lease = yield* acquire(scope);
    return yield* run(lease).pipe(
      Effect.ensuring(
        billingQuery(
          (db) =>
            db
              .prepare(
                "UPDATE billing_lock SET token='', admittedToken='', expiresAt=0 WHERE id=? AND token=?",
              )
              .bind(scope, lease.token)
              .run(),
          "lease-release-write",
        ).pipe(
          // Best-effort release: report the failure with request context, keep the outcome.
          // A zero-row release is a legitimate expired/replaced lease, never a failure.
          Effect.catch((error) =>
            reportFailureEffect(error, {
              component: "billing",
              operation: "billing.lease.release",
              phase: "lease-release",
              event: "application.cleanup",
            }),
          ),
        ),
      ),
    );
  });

/** Each transaction uses a new nonce, so expired batches cannot reuse admission. */
export const fencedBillingBatch = (
  lease: BillingLease,
  reason: string,
  build: (db: D1Database, fence: BillingFence) => D1PreparedStatement[],
  admission?: { sql: string; args: string[] },
) =>
  Effect.gen(function* () {
    const nonce = crypto.randomUUID();
    const result = yield* billingQuery((db) => {
      const fence: BillingFence = {
        sql: "EXISTS (SELECT 1 FROM billing_lock WHERE id=? AND token=? AND admittedToken=?)",
        args: [lease.scope, lease.token, nonce],
      };
      return db.batch([
        db
          .prepare(`UPDATE billing_lock SET admittedToken=? WHERE id=? AND token=? AND expiresAt > ${DB_NOW}
        ${admission === undefined ? "" : `AND (${admission.sql})`}`)
          .bind(nonce, lease.scope, lease.token, ...(admission?.args ?? [])),
        ...build(db, fence),
      ]);
    }, reason);
    if (result.length < 2 || result.some((row) => row.meta.changes !== 1)) {
      return yield* Effect.fail(billingFailure("Busy", "fence-refused"));
    }
    return undefined;
  });
