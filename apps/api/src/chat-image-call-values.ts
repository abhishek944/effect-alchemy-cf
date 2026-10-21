import { Option, Schema } from "effect";

export const CALL_EVIDENCE_BYTES = 262_144;
export const CALL_STATE_BYTES = 65_536;
export const CALL_SUMMARY_BYTES = 131_072;
export const CallDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
export const CallIndex = Schema.Number.check(
  Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= 0),
);
export const CallPositive = CallIndex.check(Schema.isGreaterThan(0));
export const CallAmount = Schema.Number.check(
  Schema.makeFilter((n) => Number.isFinite(n) && n >= 0),
);
export const CallIdentity = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.makeFilter((value) =>
    Array.from(value).every((c) => {
      const n = c.codePointAt(0) ?? 0;
      return n >= 32 && n !== 127;
    }),
  ),
);
export const CallUrl = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(8192),
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        url.href === value &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }),
);
export type ImageCallErrorCode = "invalid_input" | "conflict" | "corrupt" | "storage_error";
export class ImageCallError extends Error {
  readonly code: ImageCallErrorCode;
  constructor(code: ImageCallErrorCode) {
    super(`Image call: ${code}`);
    this.name = "ImageCallError";
    this.code = code;
  }
}
export function callBoundary<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof ImageCallError) throw error;
    throw new ImageCallError("storage_error");
  }
}
export function callValue<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown,
  code: ImageCallErrorCode = "invalid_input",
): S["Type"] {
  const result = Option.getOrNull(
    Schema.decodeUnknownOption(schema, { onExcessProperty: "error" })(value),
  );
  if (result === null) throw new ImageCallError(code);
  return result;
}

function visit(value: unknown, budget: { left: number }, depth: number): boolean {
  if (--budget.left < 0 || depth > 12) return false;
  if (typeof value === "string") budget.left -= value.length;
  else if (Array.isArray(value)) {
    if (value.length > budget.left) return false;
    for (const item of value) if (!visit(item, budget, depth + 1)) return false;
  } else if (value !== null && typeof value === "object") {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) return false;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      budget.left -= key.length;
      const item: unknown = Reflect.get(value, key);
      if (!visit(item, budget, depth + 1)) return false;
    }
  } else if (
    value !== null &&
    typeof value !== "boolean" &&
    !(typeof value === "number" && Number.isFinite(value))
  )
    return false;
  return budget.left >= 0;
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sorted(item)]),
    );
  return value;
}
export function callJson(value: unknown, max: number): string {
  if (!visit(value, { left: max }, 0)) throw new ImageCallError("invalid_input");
  const json = JSON.stringify(sorted(value));
  if (typeof json !== "string" || new TextEncoder().encode(json).byteLength > max)
    throw new ImageCallError("invalid_input");
  return json;
}
export function callFitsJson(value: unknown, max: number): boolean {
  try {
    callJson(value, max);
    return true;
  } catch {
    return false;
  }
}
export function callParse(text: string, max: number): unknown {
  if (
    typeof text !== "string" ||
    text.length > max ||
    new TextEncoder().encode(text).byteLength > max
  )
    throw new ImageCallError("corrupt");
  try {
    return JSON.parse(text);
  } catch {
    throw new ImageCallError("corrupt");
  }
}
export function freezeCall<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeCall(item);
    Object.freeze(value);
  }
  return value;
}
export function callPageSize(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new ImageCallError("invalid_input");
  return limit + 1;
}
