import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { billingError, type BillingError } from "@starter/integrations/billing";
import { Effect } from "effect";
import { billingQuery, DB_NOW } from "./billing-store.ts";

export type BillingLease = { scope: string; token: string };
export type BillingFence = { sql: string; args: [string, string, string] };

const acquire = (scope: string) =>
  Effect.gen(function* () {
    const token = crypto.randomUUID();
    const row = yield* billingQuery((db) =>
      db
        .prepare(
          `INSERT INTO billing_lock (id, token, admittedToken, expiresAt)
     VALUES (?, ?, '', ${DB_NOW} + 30)
     ON CONFLICT(id) DO UPDATE SET token=excluded.token, admittedToken='', expiresAt=excluded.expiresAt
     WHERE billing_lock.expiresAt <= ${DB_NOW} RETURNING token`,
        )
        .bind(scope, token)
        .first<{ token: string }>(),
    );
    if (row?.token !== token) return yield* Effect.fail(billingError("Busy"));
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
        billingQuery((db) =>
          db
            .prepare(
              "UPDATE billing_lock SET token='', admittedToken='', expiresAt=0 WHERE id=? AND token=?",
            )
            .bind(scope, lease.token)
            .run(),
        ).pipe(Effect.catch(() => Effect.void)),
      ),
    );
  });

/** Each transaction uses a new nonce, so expired batches cannot reuse admission. */
export const fencedBillingBatch = (
  lease: BillingLease,
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
    });
    if (result.length < 2 || result.some((row) => row.meta.changes !== 1)) {
      return yield* Effect.fail(billingError("Busy"));
    }
    return undefined;
  });
