import { Schema } from "effect";
import {
  StoredResource,
  type EventReference,
  type ResourceKind,
} from "@starter/integrations/billing";
import { billingQuery } from "./billing-store.ts";

export type CustomerRow = {
  id: string;
  scope: string;
  userId: string;
  customerId: string | null;
  createdAt: number;
};
export type CheckoutRow = {
  id: string;
  userId: string;
  requestId: string;
  scope: string;
  slug: string;
  kind: "subscription" | "one_time";
  productId: string;
  customerId: string | null;
  state: string;
  sessionId: string | null;
  url: string | null;
  createdAt: number;
};
export type ResourceRow = {
  id: string;
  scope: string;
  kind: ResourceKind;
  providerId: string;
  userId: string;
  customerId: string;
  data: string;
  syncedAt: number;
  /** Transient verified checkout association; never stored in the snapshot. */
  checkoutKey?: string;
};
export type EventRow = {
  id: string;
  scope: string;
  providerId: string;
  type: string;
  reference: string;
  state: string;
  attempts: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

export const decodeSnapshot = (row: ResourceRow) =>
  Schema.decodeUnknownSync(StoredResource)(JSON.parse(row.data));
export const customerForUser = (scope: string, userId: string) =>
  billingQuery(
    (db) =>
      db
        .prepare("SELECT * FROM billing_customer WHERE scope=? AND userId=?")
        .bind(scope, userId)
        .first<CustomerRow>(),
    "customer-read",
  );
export const customerOwner = (scope: string, customerId: string) =>
  billingQuery(
    (db) =>
      db
        .prepare("SELECT * FROM billing_customer WHERE scope=? AND customerId=?")
        .bind(scope, customerId)
        .first<CustomerRow>(),
    "customer-owner-read",
  );
export const checkoutForRequest = (userId: string, requestId: string) =>
  billingQuery(
    (db) =>
      db
        .prepare("SELECT * FROM billing_checkout WHERE userId=? AND requestId=?")
        .bind(userId, requestId)
        .first<CheckoutRow>(),
    "checkout-request-read",
  );
export const checkoutByKey = (key: string) =>
  billingQuery(
    (db) => db.prepare("SELECT * FROM billing_checkout WHERE id=?").bind(key).first<CheckoutRow>(),
    "checkout-key-read",
  );
export const pendingSubscriptionCheckout = (scope: string, userId: string, productId: string) =>
  billingQuery(
    (db) =>
      db
        .prepare(
          "SELECT * FROM billing_checkout WHERE scope=? AND userId=? AND productId=? AND kind='subscription' AND resolution='pending'",
        )
        .bind(scope, userId, productId)
        .first<CheckoutRow>(),
    "checkout-pending-read",
  );
export const checkoutForSession = (scope: string, sessionId: string) =>
  billingQuery(
    (db) =>
      db
        .prepare("SELECT * FROM billing_checkout WHERE scope=? AND sessionId=?")
        .bind(scope, sessionId)
        .first<CheckoutRow>(),
    "checkout-session-read",
  );
export const resourceByKey = (id: string) =>
  billingQuery(
    (db) => db.prepare("SELECT * FROM billing_resource WHERE id=?").bind(id).first<ResourceRow>(),
    "resource-key-read",
  );
export const resourceById = (scope: string, kind: ResourceKind, id: string) =>
  billingQuery(
    (db) =>
      db
        .prepare("SELECT * FROM billing_resource WHERE scope=? AND kind=? AND providerId=?")
        .bind(scope, kind, id)
        .first<ResourceRow>(),
    "resource-provider-read",
  );
export const purchaseForSubscription = (scope: string, subscriptionId: string) =>
  billingQuery(
    (db) =>
      db
        .prepare(
          "SELECT * FROM billing_resource WHERE scope=? AND kind='purchase' AND json_extract(data, '$.resource.subscriptionId')=? ORDER BY syncedAt, id LIMIT 1",
        )
        .bind(scope, subscriptionId)
        .first<ResourceRow>(),
    "resource-purchase-read",
  );
export const resourcesForUser = (userId: string) =>
  billingQuery(async (db) => {
    const rows = await db
      .prepare("SELECT * FROM billing_resource WHERE userId=? ORDER BY syncedAt DESC, id LIMIT 100")
      .bind(userId)
      .all<ResourceRow>();
    return rows.results;
  }, "resource-list-read");
export const customersForUser = (userId: string) =>
  billingQuery(async (db) => {
    const rows = await db
      .prepare(
        "SELECT * FROM billing_customer WHERE userId=? AND customerId IS NOT NULL ORDER BY scope",
      )
      .bind(userId)
      .all<CustomerRow>();
    return rows.results;
  }, "customer-list-read");
export const eventByKey = (id: string) =>
  billingQuery(
    (db) => db.prepare("SELECT * FROM billing_event WHERE id=?").bind(id).first<EventRow>(),
    "event-read",
  );
export const pendingEvents = () =>
  billingQuery(async (db) => {
    const rows = await db
      .prepare(
        "SELECT id, scope, type, state, attempts, error, updatedAt FROM billing_event WHERE state != 'completed' ORDER BY updatedAt LIMIT 100",
      )
      .all<
        Pick<EventRow, "id" | "scope" | "type" | "state" | "attempts" | "error" | "updatedAt">
      >();
    return rows.results;
  }, "event-list-read");
export const recordEvent = (key: string, scope: string, event: EventReference) =>
  billingQuery(async (db) => {
    await db
      .prepare(
        "INSERT INTO billing_event (id, scope, providerId, type, reference, state, attempts, error, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?) ON CONFLICT(id) DO NOTHING",
      )
      .bind(
        key,
        scope,
        event.id,
        event.type,
        JSON.stringify(event.resource),
        Date.now() / 1000,
        Date.now() / 1000,
      )
      .run();
  }, "event-record-write");
