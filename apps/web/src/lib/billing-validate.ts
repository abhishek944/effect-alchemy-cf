import type {
  AccessState,
  BillingCustomer,
  BillingProduct,
  BillingProvider,
  BillingResource,
  BillingView,
  CheckoutRedirect,
  Entitlement,
  ProductKind,
  ProviderResource,
  ResourceKind,
  StoredResource,
} from "@/lib/billing-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function isNullableText(value: unknown): value is string | null {
  return value === null || isText(value);
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullableAmount(value: unknown): value is number | null {
  return value === null || isAmount(value);
}

function isNullableCurrency(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= 16);
}

function isProvider(value: unknown): value is BillingProvider {
  return value === "dodo" || value === "polar";
}

function isProductKind(value: unknown): value is ProductKind {
  return value === "subscription" || value === "one_time";
}

function isResourceKind(value: unknown): value is ResourceKind {
  return (
    value === "subscription" || value === "purchase" || value === "refund" || value === "dispute"
  );
}

function isAccessState(value: unknown): value is AccessState {
  return value === "active" || value === "inactive";
}

function parseList<T>(value: unknown, item: (input: unknown) => input is T): T[] | null {
  if (!Array.isArray(value)) return null;
  const result: T[] = [];
  for (const entry of value as unknown[]) {
    if (!item(entry)) return null;
    result.push(entry);
  }
  return result;
}

function isProduct(value: unknown): value is BillingProduct {
  return isRecord(value) && isText(value.slug) && isText(value.label) && isProductKind(value.kind);
}

function isCustomer(value: unknown): value is BillingCustomer {
  return isRecord(value) && isText(value.scope) && isProvider(value.provider);
}

function isEntitlement(value: unknown): value is Entitlement {
  return (
    isRecord(value) && isText(value.slug) && isProductKind(value.kind) && isText(value.productId)
  );
}

function isLineItem(value: unknown): value is { id: string; quantity: number } {
  return isRecord(value) && isText(value.id) && isAmount(value.quantity);
}

function isProviderResource(value: unknown): value is ProviderResource {
  if (!isRecord(value)) return false;
  return (
    isResourceKind(value.kind) &&
    isText(value.id) &&
    isText(value.customerId) &&
    isNullableText(value.productId) &&
    isText(value.status) &&
    isNullableText(value.subscriptionId) &&
    isNullableText(value.purchaseId) &&
    isNullableText(value.checkoutId) &&
    isNullableAmount(value.amount) &&
    isNullableCurrency(value.currency) &&
    isNullableText(value.periodEnd) &&
    typeof value.cancelAtPeriodEnd === "boolean" &&
    isAccessState(value.accessState) &&
    isAmount(value.refundedAmount) &&
    typeof value.disputed === "boolean" &&
    parseList(value.products, isLineItem) !== null
  );
}

function isStoredResource(value: unknown): value is StoredResource {
  return (
    isRecord(value) &&
    isProviderResource(value.resource) &&
    parseList(value.entitlements, isEntitlement) !== null
  );
}

function isResource(value: unknown): value is BillingResource {
  if (!isRecord(value)) return false;
  return (
    isText(value.key) &&
    isText(value.scope) &&
    isProvider(value.provider) &&
    isStoredResource(value.snapshot) &&
    typeof value.syncedAt === "number" &&
    Number.isFinite(value.syncedAt) &&
    typeof value.stale === "boolean" &&
    typeof value.access === "boolean"
  );
}

/** Validated GET /api/billing payload, or null when any field is unexpected. */
export function parseBillingView(value: unknown): BillingView | null {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return null;
  const defaultProvider = value.defaultProvider;
  if (defaultProvider !== null && !isProvider(defaultProvider)) return null;
  const products = parseList(value.products, isProduct);
  const customers = parseList(value.customers, isCustomer);
  const resources = parseList(value.resources, isResource);
  if (!products || !customers || !resources) return null;
  return { enabled: value.enabled, defaultProvider, products, customers, resources };
}

/** Absolute HTTPS URL, or null for anything else. */
export function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Validated POST /api/billing/checkout payload. */
export function parseCheckout(value: unknown): CheckoutRedirect | null {
  if (!isRecord(value) || !isText(value.id)) return null;
  const url = httpsUrl(value.url);
  return url ? { id: value.id, url } : null;
}

/** Validated POST /api/billing/portal payload. */
export function parsePortal(value: unknown): { url: string } | null {
  if (!isRecord(value)) return null;
  const url = httpsUrl(value.url);
  return url ? { url } : null;
}

/** Validated POST /api/billing/refresh payload. */
export function parseRefresh(value: unknown): boolean {
  return isRecord(value) && value.ok === true;
}
