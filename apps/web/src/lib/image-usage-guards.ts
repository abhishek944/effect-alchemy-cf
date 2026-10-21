import { isRecord } from "./chat-validate-base";
import type { ImageUsageValue } from "./image-usage-types";

export const imageAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
export const imageCount = (value: unknown): value is number =>
  imageAmount(value) && Number.isSafeInteger(value);
export const imagePositive = (value: unknown): value is number => imageCount(value) && value > 0;
export const imageKey = (value: string): boolean => /^[A-Za-z0-9_.:-]{1,64}$/.test(value);
export function imageText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    Array.from(value).every((c) => (c.codePointAt(0) ?? 0) >= 32)
  );
}
export function imageLabels(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64 && value.every(imageText);
}
export function nativeImageMessageId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9][0-9]{0,15}:(0|[1-9][0-9]{0,15})$/.test(value) &&
    value.split(":").every((part) => Number.isSafeInteger(Number(part)))
  );
}

/** Bound the unknown tree before serialization, including wide/deep malformed values. */
export function imageJsonFits(value: unknown, max: number): boolean {
  const budget = { left: max };
  const visit = (item: unknown, depth: number): boolean => {
    if (--budget.left < 0 || depth > 12) return false;
    if (typeof item === "string") budget.left -= item.length;
    else if (Array.isArray(item)) {
      if (item.length > budget.left) return false;
      for (const child of item) if (!visit(child, depth + 1)) return false;
    } else if (isRecord(item)) {
      for (const [key, child] of Object.entries(item)) {
        budget.left -= key.length;
        if (!visit(child, depth + 1)) return false;
      }
    } else if (item !== null && typeof item !== "boolean" && !imageAmount(item)) return false;
    return budget.left >= 0;
  };
  if (!visit(value, 0)) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= max;
  } catch {
    return false;
  }
}

const tags = new Set([
  "text",
  "image",
  "audio",
  "video",
  "input",
  "output",
  "cached",
  "uncached",
  "tokens",
]);
export function imageReportedUsage(
  value: unknown,
): value is Readonly<Record<string, ImageUsageValue>> {
  const budget = { nodes: 256, keys: 64 };
  const visit = (item: unknown, depth: number): boolean => {
    if (--budget.nodes < 0) return false;
    if (typeof item === "number") return imageAmount(item) && item <= Number.MAX_SAFE_INTEGER;
    if (typeof item === "string") return tags.has(item);
    if (typeof item === "boolean" || item === null) return true;
    if (depth >= 4) return false;
    if (Array.isArray(item))
      return item.length <= 16 && item.every((child) => visit(child, depth + 1));
    if (!isRecord(item)) return false;
    const proto: unknown = Object.getPrototypeOf(item);
    if (proto !== null && proto !== Object.prototype) return false;
    return Object.entries(item).every(
      ([key, child]) =>
        imageKey(key) &&
        !["__proto__", "constructor", "prototype"].includes(key) &&
        --budget.keys >= 0 &&
        visit(child, depth + 1),
    );
  };
  return isRecord(value) && visit(value, 0);
}
