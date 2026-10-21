import { Predicate } from "effect";

export type NativeValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | readonly NativeValue[]
  | { readonly [key: string]: NativeValue | undefined };
export type NativeWireLimits = {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxArrayLength: number;
  readonly maxMapLength: number;
  readonly maxStringBytes: number;
  readonly maxBinaryBytes: number;
};
export class NativeWireError extends Error {
  readonly code: "INVALID_FRAME" | "LIMIT_EXCEEDED";
  constructor(code: "INVALID_FRAME" | "LIMIT_EXCEEDED") {
    super(code === "LIMIT_EXCEEDED" ? "Native frame exceeds its limit." : "Invalid native frame.");
    this.name = "NativeWireError";
    this.code = code;
  }
}
const encoder = new TextEncoder();
const malformedUtf16 = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
export const forbiddenNativeKey = (key: string): boolean =>
  key === "__proto__" || key === "constructor" || key === "prototype";

/** Iterative pre-encode validation: no getters, cycles, extension objects or unbounded fanout. */
export function validateNativeValue(
  value: unknown,
  limits: NativeWireLimits,
): asserts value is NativeValue {
  const stack: { value: unknown; depth: number; exit?: object }[] = [{ value, depth: 0 }];
  const active = new Set<object>();
  let nodes = 0;
  let size = 0;
  const add = (bytes: number) => {
    size += bytes;
    if (size > limits.maxBytes) throw new NativeWireError("LIMIT_EXCEEDED");
  };
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    if (next.exit !== undefined) {
      active.delete(next.exit);
      continue;
    }
    if (++nodes > limits.maxNodes || next.depth > limits.maxDepth)
      throw new NativeWireError("LIMIT_EXCEEDED");
    const current = next.value;
    if (current === undefined) {
      add(3);
      continue;
    }
    if (current === null || typeof current === "boolean") {
      add(1);
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new NativeWireError("INVALID_FRAME");
      add(9);
      continue;
    }
    if (typeof current === "string") {
      if (malformedUtf16.test(current)) throw new NativeWireError("INVALID_FRAME");
      if (current.length > limits.maxStringBytes) throw new NativeWireError("LIMIT_EXCEEDED");
      const bytes = encoder.encode(current).byteLength;
      if (bytes > limits.maxStringBytes) throw new NativeWireError("LIMIT_EXCEEDED");
      add(5 + bytes);
      continue;
    }
    if (current instanceof Uint8Array) {
      // Binary vectors are bytes, not object maps; never enumerate potentially huge index sets.
      if (current.byteLength > limits.maxBinaryBytes) throw new NativeWireError("LIMIT_EXCEEDED");
      add(5 + current.byteLength);
      continue;
    }
    if (!Predicate.isObjectOrArray(current)) throw new NativeWireError("INVALID_FRAME");
    if (active.has(current)) throw new NativeWireError("INVALID_FRAME");
    active.add(current);
    stack.push({ value: null, depth: 0, exit: current });
    add(5);
    if (Object.getOwnPropertySymbols(current).length > 0)
      throw new NativeWireError("INVALID_FRAME");
    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype)
        throw new NativeWireError("INVALID_FRAME");
      if (current.length > limits.maxArrayLength) throw new NativeWireError("LIMIT_EXCEEDED");
      if (Object.getOwnPropertyNames(current).length !== current.length + 1)
        throw new NativeWireError("INVALID_FRAME");
      for (let i = current.length - 1; i >= 0; i--) {
        const entry = Object.getOwnPropertyDescriptor(current, String(i));
        if (!entry || !("value" in entry)) throw new NativeWireError("INVALID_FRAME");
        stack.push({ value: entry.value, depth: next.depth + 1 });
      }
    } else {
      const proto: unknown = Object.getPrototypeOf(current);
      if (proto !== Object.prototype && proto !== null) throw new NativeWireError("INVALID_FRAME");
      const keys = Object.keys(current);
      if (Object.getOwnPropertyNames(current).length !== keys.length)
        throw new NativeWireError("INVALID_FRAME");
      if (keys.length > limits.maxMapLength) throw new NativeWireError("LIMIT_EXCEEDED");
      for (const key of keys) {
        if (++nodes > limits.maxNodes || next.depth + 1 > limits.maxDepth)
          throw new NativeWireError("LIMIT_EXCEEDED");
        if (forbiddenNativeKey(key) || malformedUtf16.test(key))
          throw new NativeWireError("INVALID_FRAME");
        const entry = Object.getOwnPropertyDescriptor(current, key);
        if (!entry || !("value" in entry)) throw new NativeWireError("INVALID_FRAME");
        if (key.length > limits.maxStringBytes) throw new NativeWireError("LIMIT_EXCEEDED");
        const keyBytes = encoder.encode(key).byteLength;
        if (keyBytes > limits.maxStringBytes) throw new NativeWireError("LIMIT_EXCEEDED");
        add(5 + keyBytes);
        stack.push({ value: entry.value, depth: next.depth + 1 });
      }
    }
  }
}
