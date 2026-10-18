import { newBillingRequestId } from "@/lib/billing-api";
import type { BillingResource, BillingView } from "@/lib/billing-types";

/**
 * Scoped, non-secret checkout intent metadata for this browser session.
 * Only the request UUID and the accepted checkout receipt id are stored,
 * keyed by user id and product slug; no tokens, names or emails.
 */
export type BillingAttempt = {
  requestId: string;
  sessionId: string | null;
};

export const STORAGE_UNAVAILABLE_MESSAGE =
  "Checkout needs browser session storage to remember this attempt. Enable site storage and try again.";

const KEY_PREFIX = "billing-attempts:v1:";

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAttempt(value: unknown): value is BillingAttempt {
  if (!isRecord(value)) return false;
  const requestId = value.requestId;
  const sessionId = value.sessionId;
  return (
    typeof requestId === "string" &&
    requestId.length > 0 &&
    requestId.length <= 128 &&
    (sessionId === null ||
      (typeof sessionId === "string" && sessionId.length > 0 && sessionId.length <= 256))
  );
}

function parseAttempts(raw: string): Record<string, BillingAttempt> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const attempts: Record<string, BillingAttempt> = {};
  for (const [slug, value] of Object.entries(parsed)) {
    if (isAttempt(value)) attempts[slug] = value;
  }
  return attempts;
}

function readAttempts(userId: string): Record<string, BillingAttempt> | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(storageKey(userId));
  } catch {
    return null;
  }
  if (raw === null) return {};
  return parseAttempts(raw);
}

function writeAttempts(userId: string, attempts: Record<string, BillingAttempt>): boolean {
  const store = storage();
  if (!store) return false;
  const key = storageKey(userId);
  const value = JSON.stringify(attempts);
  try {
    store.setItem(key, value);
    return store.getItem(key) === value;
  } catch {
    return false;
  }
}

/**
 * Returns the retained intent for this user and slug, persisting a new one
 * only when none exists. A null result means storage could not be read or
 * written, so the caller must not start a payment API call.
 */
export function beginBillingAttempt(userId: string, slug: string): BillingAttempt | null {
  const attempts = readAttempts(userId);
  if (attempts === null) return null;
  const existing = attempts[slug];
  if (existing) return existing;
  const attempt: BillingAttempt = { requestId: newBillingRequestId(), sessionId: null };
  attempts[slug] = attempt;
  return writeAttempts(userId, attempts) ? attempt : null;
}

/** Records the accepted checkout receipt so a reload can correlate it later. */
export function recordBillingReceipt(
  userId: string,
  slug: string,
  requestId: string,
  sessionId: string,
): boolean {
  const attempts = readAttempts(userId);
  if (attempts === null) return false;
  attempts[slug] = { requestId, sessionId };
  return writeAttempts(userId, attempts);
}

const COMPLETED_PURCHASE_STATUSES = new Set([
  "active",
  "paid",
  "partially_refunded",
  "refunded",
  "succeeded",
]);

const COMPLETED_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

function normalizedStatus(status: string): string {
  return status
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
}

function isCompletionEvidence(resource: BillingResource, sessionId: string): boolean {
  const item = resource.snapshot.resource;
  if (item.checkoutId !== sessionId) return false;
  const status = normalizedStatus(item.status);
  if (item.kind === "purchase") return COMPLETED_PURCHASE_STATUSES.has(status);
  if (item.kind === "subscription") return COMPLETED_SUBSCRIPTION_STATUSES.has(status);
  return false;
}

/**
 * Clears only intents whose stored receipt correlates with an owned resource
 * that proves completion: purchases with an authoritative succeeded, paid,
 * refunded (including partial) or active status, and active or trialing subscriptions. A refund
 * or dispute does not hide a completed charge. Failed and pending statuses
 * never clear an intent, and providers that omit checkout ids leave their
 * intents unresolved.
 */
export function reconcileBillingAttempts(userId: string, view: BillingView): void {
  const attempts = readAttempts(userId);
  if (attempts === null) return;
  let changed = false;
  for (const [slug, attempt] of Object.entries(attempts)) {
    const sessionId = attempt.sessionId;
    if (!sessionId) continue;
    const completed = view.resources.some((resource) => isCompletionEvidence(resource, sessionId));
    if (completed) {
      delete attempts[slug];
      changed = true;
    }
  }
  if (changed) writeAttempts(userId, attempts);
}
