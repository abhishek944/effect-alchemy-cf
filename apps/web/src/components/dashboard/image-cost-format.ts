import type { ImageCost } from "@/lib/image-usage-types";

/** Do not round a small positive amount into a displayed zero. Currency stays original. */
export function imageMoney(value: number, currency = "USD"): string {
  if (value > 0 && value < 0.000001) return `<0.000001 ${currency}`;
  return `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value)} ${currency}`;
}

export function imageCostLabel(cost: ImageCost): string {
  if (cost.kind === "unknown") return "Unknown";
  if (cost.kind === "reported")
    return cost.basis === "provider-response" ? "Provider reported" : "Gateway estimate";
  return cost.completeness === "complete" ? "Complete estimate" : "Partial known components";
}

export function imageCostAmount(cost: ImageCost): string {
  return cost.kind === "unknown"
    ? "Unknown"
    : cost.kind === "reported"
      ? imageMoney(cost.amount, cost.currency)
      : imageMoney(cost.usd);
}

export function imageEvidence(cost: ImageCost): {
  missing: readonly string[];
  sources: readonly string[];
} {
  if (cost.kind === "unknown") return { missing: cost.missing, sources: [] };
  if (cost.kind === "reported") return { missing: [], sources: [cost.source, cost.basis] };
  return { missing: cost.missing, sources: cost.sources };
}
