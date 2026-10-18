/** Numeric-only formatting for the usage tray and response facts. */
import type { ChatUsage, ChatUsageCompleteness } from "@/lib/chat-capability-usage-types";

export function compactTokens(value: number): string {
  if (value < 1000) return `${value}`;
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    const digits = millions >= 100 ? 0 : millions >= 10 ? 1 : 2;
    const text = millions.toFixed(digits);
    return `${text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text}M`;
  }
  const thousands = value / 1000;
  const digits = thousands >= 100 ? 0 : 1;
  return `${thousands.toFixed(digits).replace(/\.0$/, "")}k`;
}

export function exactTokens(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/** Catalog-price estimate, never an invoice: four or five decimal places. */
export function formatCost(value: number): string {
  if (value === 0) return "$0.00";
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(5)}`;
}

export function formatPercent(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function completenessLabel(completeness: ChatUsageCompleteness): string {
  if (completeness === "complete") return "Complete";
  if (completeness === "unknown") return "Unknown";
  return "Partial — some categories are unknown";
}

export type KnownSubtotal = { known: number; token: number | null; speech: number | null };

/**
 * One shared known-subtotal calculation: token counters plus known speech cost,
 * each added once. A missing part stays unknown instead of counting as zero.
 */
export function knownSubtotal(usage: ChatUsage): KnownSubtotal | null {
  const token = usage.amount.estimatedCostUsd;
  const speech = usage.speech.estimatedCostUsd;
  if (token === null && speech === null) return null;
  return { known: (token ?? 0) + (speech ?? 0), token, speech };
}
