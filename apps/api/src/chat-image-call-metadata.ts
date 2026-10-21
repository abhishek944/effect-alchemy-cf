import type { ReportedUsage } from "@abhishek944/pi-image-gen/core";
import { Schema } from "effect";
import {
  CallAmount,
  CallIndex,
  CallPositive,
  CALL_STATE_BYTES,
  callJson,
} from "./chat-image-call-values.ts";

const SafeText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.makeFilter((value) => Array.from(value).every((c) => (c.codePointAt(0) ?? 0) >= 32)),
);
const Labels = Schema.Array(SafeText).check(Schema.isMaxLength(64));
const UsageKey = /^[A-Za-z0-9_.:-]{1,64}$/;
const UsageTags = new Set([
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
function safeUsage(
  value: unknown,
  depth: number,
  budget: { nodes: number; keys: number },
): boolean {
  if (--budget.nodes < 0) return false;
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
  if (typeof value === "string") return UsageTags.has(value);
  if (typeof value === "boolean" || value === null) return true;
  if (depth >= 4 || typeof value !== "object") return false;
  if (Array.isArray(value))
    return value.length <= 16 && value.every((item) => safeUsage(item, depth + 1, budget));
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) return false;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    const item: unknown = Reflect.get(value, key);
    if (
      !UsageKey.test(key) ||
      ["__proto__", "constructor", "prototype"].includes(key) ||
      --budget.keys < 0 ||
      !safeUsage(item, depth + 1, budget)
    )
      return false;
  }
  return true;
}
const ReportedUsageSchema = Schema.declare<ReportedUsage>(
  (value): value is ReportedUsage =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    safeUsage(value, 0, { nodes: 256, keys: 64 }),
);
export const ImageCallCost = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("reported"),
    amount: CallAmount,
    currency: Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_-]{0,19}$/)),
    source: Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/)),
    basis: Schema.Literals(["provider-response", "gateway-estimate"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("estimated"),
    completeness: Schema.Literals(["complete", "partial"]),
    usd: CallAmount,
    components: Schema.Record(Schema.String.check(Schema.isPattern(UsageKey)), CallAmount),
    missing: Labels,
    sources: Labels,
  }).check(
    Schema.makeFilter((cost) => {
      const sum = Object.values(cost.components).reduce((total, n) => total + n, 0);
      return (
        Object.keys(cost.components).length <= 64 &&
        Number.isFinite(sum) &&
        Math.abs(sum - cost.usd) <= Number.EPSILON * Math.max(1, sum, cost.usd) * 64 &&
        (cost.completeness !== "complete" || cost.missing.length === 0)
      );
    }),
  ),
  Schema.Struct({ kind: Schema.Literal("unknown"), missing: Labels }),
]);
export type ImageCallCost = typeof ImageCallCost.Type;
export const ImageCallOutputDescriptor = Schema.Struct({
  index: CallIndex,
  mimeType: SafeText,
  bytes: CallPositive,
  width: Schema.optionalKey(CallPositive),
  height: Schema.optionalKey(CallPositive),
  revisedPrompt: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(32_000))),
});
export const ImageCallMetadata = Schema.Struct({
  model: SafeText,
  provider: SafeText,
  durationMs: CallAmount,
  requestId: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._:/-]{1,200}$/))),
  reportedUsage: Schema.optionalKey(ReportedUsageSchema),
  cost: ImageCallCost,
  outputs: Schema.Array(ImageCallOutputDescriptor),
  quality: Schema.optionalKey(SafeText),
  size: Schema.optionalKey(SafeText),
}).check(
  Schema.makeFilter((metadata) => {
    try {
      callJson(metadata, CALL_STATE_BYTES);
      return (
        new Set(metadata.outputs.map((output) => output.index)).size === metadata.outputs.length
      );
    } catch {
      return false;
    }
  }),
);
export type ImageCallMetadata = typeof ImageCallMetadata.Type;
