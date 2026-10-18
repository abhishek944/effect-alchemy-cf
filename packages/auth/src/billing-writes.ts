import type { BillingError } from "@starter/integrations/billing";
import type { CheckoutRow, ResourceRow } from "./billing-data.ts";
import { fencedBillingBatch, type BillingLease } from "./billing-lease.ts";
import { billingQuery, DB_NOW } from "./billing-store.ts";

export const reserveCustomer = (lease: BillingLease, id: string, userId: string) =>
  fencedBillingBatch(lease, (db, fence) => [
    db
      .prepare(
        `INSERT INTO billing_customer (id, scope, userId, providerKey, customerId, createdAt)
     SELECT ?, ?, ?, ?, NULL, ${DB_NOW} WHERE ${fence.sql}`,
      )
      .bind(id, lease.scope, userId, `pending:${id}`, ...fence.args),
  ]);

export const saveCustomer = (lease: BillingLease, id: string, customerId: string) =>
  fencedBillingBatch(lease, (db, fence) => [
    db
      .prepare(
        `UPDATE billing_customer SET customerId=?, providerKey=? WHERE id=? AND scope=? AND ${fence.sql}`,
      )
      .bind(customerId, customerId, id, lease.scope, ...fence.args),
  ]);

export const reserveCheckout = (lease: BillingLease, row: CheckoutRow) =>
  fencedBillingBatch(lease, (db, fence) => [
    db
      .prepare(
        `INSERT INTO billing_checkout (id, userId, requestId, scope, slug, kind, productId,
     customerId, state, sessionId, sessionKey, subscriptionKey, resolution, url, createdAt)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, 'pending', NULL, ${DB_NOW}
     WHERE ${fence.sql} AND (? != 'subscription' OR NOT EXISTS (
       SELECT 1 FROM billing_resource WHERE userId=? AND kind='subscription'
       AND json_extract(data, '$.resource.status') NOT IN
       ('cancelled','canceled','expired','failed','unpaid','incomplete_expired')
     ))`,
      )
      .bind(
        row.id,
        row.userId,
        row.requestId,
        row.scope,
        row.slug,
        row.kind,
        row.productId,
        row.customerId,
        `pending:${row.id}`,
        row.kind === "subscription"
          ? `subscription:${row.userId}`
          : `purchase:${row.userId}:${row.slug}`,
        ...fence.args,
        row.kind,
        row.userId,
      ),
  ]);

export const completeCheckout = (
  lease: BillingLease,
  id: string,
  customerId: string,
  sessionId: string,
  url: string,
) =>
  fencedBillingBatch(lease, (db, fence) => [
    db
      .prepare(
        `UPDATE billing_checkout SET state='ready', customerId=?, sessionId=?, sessionKey=?, url=?
   WHERE id=? AND scope=? AND state='pending' AND ${fence.sql}`,
      )
      .bind(customerId, sessionId, sessionId, url, id, lease.scope, ...fence.args),
  ]);

export const claimEvent = (lease: BillingLease, key: string) =>
  fencedBillingBatch(lease, (db, fence) => [
    db
      .prepare(
        `UPDATE billing_event SET state='processing', leaseToken=?, attempts=attempts+1,
     error=NULL, updatedAt=${DB_NOW} WHERE id=? AND state!='completed' AND ${fence.sql}`,
      )
      .bind(lease.token, key, ...fence.args),
  ]);

export const failEvent = (key: string, token: string, kind: BillingError["kind"]) =>
  billingQuery((db) =>
    db
      .prepare(
        `UPDATE billing_event SET state='failed', error=?, updatedAt=${DB_NOW}
     WHERE id=? AND leaseToken=? AND state!='completed'`,
      )
      .bind(kind, key, token)
      .run(),
  );

export const saveResources = (
  lease: BillingLease,
  rows: ResourceRow[],
  eventKey?: string,
  complete = true,
) =>
  fencedBillingBatch(
    lease,
    (db, fence) => [
      ...rows.map((row) =>
        db
          .prepare(
            `INSERT INTO billing_resource (id, scope, kind, providerId, userId, customerId, data, syncedAt)
       SELECT ?, ?, ?, ?, ?, ?, ?, ${DB_NOW} WHERE ${fence.sql}
       ON CONFLICT(id) DO UPDATE SET data=excluded.data, syncedAt=excluded.syncedAt,
       userId=CASE WHEN billing_resource.userId=excluded.userId THEN excluded.userId ELSE NULL END,
       customerId=CASE WHEN billing_resource.customerId=excluded.customerId THEN excluded.customerId ELSE NULL END`,
          )
          .bind(
            row.id,
            lease.scope,
            row.kind,
            row.providerId,
            row.userId,
            row.customerId,
            row.data,
            ...fence.args,
          ),
      ),
      ...[...new Set(rows.flatMap((row) => (row.checkoutKey ? [row.checkoutKey] : [])))].map(
        (key) =>
          db
            .prepare(`UPDATE billing_checkout SET resolution='resolved', subscriptionKey=?
        WHERE id=? AND scope=? AND ${fence.sql}`)
            .bind(`checkout:${key}`, key, lease.scope, ...fence.args),
      ),
      ...(eventKey === undefined || !complete
        ? []
        : [
            db
              .prepare(
                `UPDATE billing_event SET state='completed', error=NULL, updatedAt=${DB_NOW}
       WHERE id=? AND leaseToken=? AND state='processing' AND ${fence.sql}`,
              )
              .bind(eventKey, lease.token, ...fence.args),
          ]),
    ],
    eventKey === undefined
      ? undefined
      : {
          sql: "EXISTS (SELECT 1 FROM billing_event WHERE id=? AND leaseToken=? AND state='processing')",
          args: [eventKey, lease.token],
        },
  );
