import type { BillingView, CheckoutRedirect } from "@/lib/billing-types";
import { readResponseRequestId, serverReference, withReference } from "@/lib/browser-diagnostics";
import {
  httpsUrl,
  parseBillingView,
  parseCheckout,
  parsePortal,
  parseRefresh,
} from "@/lib/billing-validate";

const UNEXPECTED = "The server returned an unexpected response. Reload the page and try again.";
const NETWORK = "Could not reach the server. Check your connection and try again.";

const STATUS_MESSAGES: Record<number, string> = {
  400: "That request was not valid. Reload the page and try again.",
  401: "You are signed out. Sign in again to manage billing.",
  403: "This action is not allowed for your account.",
  404: "That billing record is no longer available.",
  409: "The last attempt may still be processing. An operator may need to reconcile it before you try again.",
  503: "Billing is temporarily unavailable. Try again shortly.",
};

export class BillingApiError extends Error {
  readonly status: number;
  readonly requestId: string | null;

  constructor(
    status: number,
    message: string,
    requestId: string | null = null,
    operation = "billing.request",
    responseStatus = status,
  ) {
    super(withReference(message, serverReference(operation, responseStatus, requestId)));
    this.name = "BillingApiError";
    this.status = status;
    this.requestId = requestId;
  }
}

/** Safe, status-based message for display; never echoes a server body. */
export function billingErrorMessage(error: unknown): string {
  if (error instanceof BillingApiError) return error.message;
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The request was cancelled.";
  }
  if (error instanceof TypeError) return NETWORK;
  return "Something went wrong. Please try again.";
}

function statusMessage(status: number): string {
  return STATUS_MESSAGES[status] ?? `Billing request failed (${status}).`;
}

async function request(
  path: string,
  operation: string,
  init?: RequestInit,
): Promise<{ body: unknown; requestId: string | null; status: number }> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      ...init,
    });
  } catch (cause) {
    if (init?.signal?.aborted) throw cause;
    throw new BillingApiError(0, NETWORK, null, operation);
  }
  const requestId = readResponseRequestId(response);
  if (!response.ok) {
    throw new BillingApiError(
      response.status,
      statusMessage(response.status),
      requestId,
      operation,
    );
  }
  if (response.status === 204) return { body: null, requestId, status: response.status };
  try {
    return { body: await response.json(), requestId, status: response.status };
  } catch (cause) {
    if (init?.signal?.aborted) throw cause;
    throw new BillingApiError(502, UNEXPECTED, requestId, operation, response.status);
  }
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { accept: "application/json", "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** One UUID per logical checkout attempt; reused by the caller across retries. */
export function newBillingRequestId(): string {
  return crypto.randomUUID();
}

export async function fetchBilling(signal?: AbortSignal): Promise<BillingView> {
  const { body, requestId, status } = await request(
    "/api/billing",
    "billing.view",
    signal ? { signal } : undefined,
  );
  const view = parseBillingView(body);
  if (!view) throw new BillingApiError(502, UNEXPECTED, requestId, "billing.view", status);
  return view;
}

export async function startCheckout(slug: string, requestId: string): Promise<CheckoutRedirect> {
  const seen = await request(
    "/api/billing/checkout",
    "billing.checkout",
    post({ slug, requestId }),
  );
  const checkout = parseCheckout(seen.body);
  if (!checkout)
    throw new BillingApiError(502, UNEXPECTED, seen.requestId, "billing.checkout", seen.status);
  return checkout;
}

export async function openPortal(scope: string): Promise<string> {
  const seen = await request("/api/billing/portal", "billing.portal", post({ scope }));
  const portal = parsePortal(seen.body);
  if (!portal)
    throw new BillingApiError(502, UNEXPECTED, seen.requestId, "billing.portal", seen.status);
  return portal.url;
}

export async function refreshResource(key: string): Promise<void> {
  const seen = await request("/api/billing/refresh", "billing.refresh", post({ key }));
  const ok = parseRefresh(seen.body);
  if (!ok)
    throw new BillingApiError(502, UNEXPECTED, seen.requestId, "billing.refresh", seen.status);
}

/** Redirects only to an absolute HTTPS URL; anything else becomes a safe error. */
export function redirectToProvider(url: string): void {
  const target = httpsUrl(url);
  if (!target) throw new BillingApiError(502, UNEXPECTED);
  window.location.assign(target);
}
