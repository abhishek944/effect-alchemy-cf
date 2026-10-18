import type { BillingProvider, ProductKind, ResourceKind } from "@/lib/billing-types";

const PROVIDER_LABELS: Record<BillingProvider, string> = {
  dodo: "Dodo Payments",
  polar: "Polar",
};

export function providerLabel(provider: BillingProvider): string {
  return PROVIDER_LABELS[provider];
}

const KIND_LABELS: Record<ResourceKind | ProductKind, string> = {
  subscription: "Subscription",
  purchase: "Purchase",
  refund: "Refund",
  dispute: "Dispute",
  one_time: "One-time purchase",
};

export function kindLabel(kind: ResourceKind | ProductKind): string {
  return KIND_LABELS[kind];
}

/** Provider status text stays recognizable; only separators are softened. */
export function statusLabel(status: string): string {
  const text = status.replace(/[_-]+/g, " ").trim();
  if (!text) return "Unknown status";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Amounts arrive in currency minor units. The divisor comes from the resolved
 * currency fraction digits, so zero-decimal and three-decimal currencies stay
 * correct instead of always dividing by 100.
 */
export function formatAmount(amount: number | null, currency: string | null): string | null {
  if (amount === null) return null;
  const code = currency ? currency.toUpperCase() : null;
  if (!code || !/^[A-Z]{3}$/.test(code)) {
    return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  try {
    const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency: code });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amount / 10 ** digits);
  } catch {
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${code}`;
  }
}

export function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function formatTimestamp(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "an unknown time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
