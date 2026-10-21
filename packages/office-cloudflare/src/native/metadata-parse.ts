import { Array as Arr, Predicate, Schema } from "effect";
import { NativeStorageError } from "./types.ts";

export const NativeName = Schema.String.check(
  Schema.isMaxLength(256),
  Schema.isMinLength(1),
  Schema.makeFilter((value) => new TextEncoder().encode(value).length <= 256),
);
export const Natural = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export const NativeType = Schema.Literals([1, 2, 3]);
export function objectFields(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!Predicate.isObject(input))
    throw new NativeStorageError("CONTENT", "Native metadata must be a plain object");
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    throw new NativeStorageError("CONTENT", "Native metadata cannot contain classes");
  const keys = Reflect.ownKeys(input);
  if (
    keys.length > allowed.length ||
    keys.some((key) => typeof key !== "string" || !allowed.includes(key))
  ) {
    throw new NativeStorageError("CONTENT", "Unexpected native metadata field");
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      throw new NativeStorageError("CONTENT", "Native metadata cannot contain accessors");
  }
  return input;
}
export function boundedArray(input: unknown, maximum: number): readonly unknown[] {
  if (
    !Arr.isArray(input) ||
    input.length > maximum ||
    Reflect.ownKeys(input).length !== input.length + 1
  ) {
    throw new NativeStorageError("LIMIT", "Invalid native metadata array");
  }
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor))
      throw new NativeStorageError("CONTENT", "Invalid native metadata array entry");
  }
  return input;
}
export function parseMetadata<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(input);
  } catch {
    throw new NativeStorageError("CONTENT", "Invalid bounded native metadata");
  }
}
