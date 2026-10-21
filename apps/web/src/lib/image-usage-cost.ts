import { isRecord } from "./chat-validate-base";
import { imageAmount, imageKey, imageLabels } from "./image-usage-guards";
import type { ImageCost } from "./image-usage-types";

export function parseImageCost(value: unknown): ImageCost | null {
  if (!isRecord(value)) return null;
  if (value.kind === "reported") {
    if (
      !imageAmount(value.amount) ||
      typeof value.currency !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,19}$/.test(value.currency)
    )
      return null;
    if (typeof value.source !== "string" || !/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(value.source))
      return null;
    if (value.basis !== "provider-response" && value.basis !== "gateway-estimate") return null;
    return {
      kind: "reported",
      amount: value.amount,
      currency: value.currency,
      source: value.source,
      basis: value.basis,
    };
  }
  if (value.kind === "unknown")
    return imageLabels(value.missing) ? { kind: "unknown", missing: [...value.missing] } : null;
  if (value.kind !== "estimated" || !imageAmount(value.usd)) return null;
  if (value.completeness !== "complete" && value.completeness !== "partial") return null;
  if (!imageLabels(value.missing) || !imageLabels(value.sources) || !isRecord(value.components))
    return null;
  const entries = Object.entries(value.components);
  if (entries.length > 64) return null;
  const components: [string, number][] = [];
  let sum = 0;
  for (const [key, amount] of entries) {
    if (!imageKey(key) || !imageAmount(amount)) return null;
    components.push([key, amount]);
    sum += amount;
  }
  if (
    !Number.isFinite(sum) ||
    Math.abs(sum - value.usd) > Number.EPSILON * Math.max(1, sum, value.usd) * 64
  )
    return null;
  if (value.completeness === "complete" && value.missing.length !== 0) return null;
  return {
    kind: "estimated",
    completeness: value.completeness,
    usd: value.usd,
    components: Object.fromEntries(components),
    missing: [...value.missing],
    sources: [...value.sources],
  };
}
