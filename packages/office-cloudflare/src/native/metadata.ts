import { nativeLimits, NativeStorageError } from "./types.ts";

/** SQL-bound normalized metadata DTOs only, never SDK document content. */
export function metadata(value: unknown, limit: number = nativeLimits.metadataBytes): string {
  const stack: { value: unknown; exit?: object }[] = [{ value }];
  const active = new Set<object>();
  while (stack.length) {
    const next = stack.pop();
    if (!next) break;
    if (next.exit) {
      active.delete(next.exit);
      continue;
    }
    const item = next.value;
    if (
      item === undefined ||
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    )
      continue;
    if (typeof item === "number") {
      if (!Number.isFinite(item))
        throw new NativeStorageError("CONTENT", "Nonfinite metadata number");
      continue;
    }
    if (typeof item !== "object")
      throw new NativeStorageError("CONTENT", "Unsupported native metadata value");
    const prototype: unknown = Object.getPrototypeOf(item);
    if (
      (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) ||
      active.has(item)
    )
      throw new NativeStorageError("CONTENT", "Metadata classes/cycles are not supported");
    active.add(item);
    stack.push({ value: null, exit: item });
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (Array.isArray(item) && key === "length") continue;
      if (typeof key !== "string")
        throw new NativeStorageError("CONTENT", "Metadata symbols are unsupported");
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
        throw new NativeStorageError("CONTENT", "Metadata accessors are unsupported");
      stack.push({ value: descriptor.value });
    }
  }
  const result = JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
  // Actual encoded SQL value width, not a guessed traversal/fanout estimate.
  if (!result || new TextEncoder().encode(result).length > limit)
    throw new NativeStorageError("LIMIT", "Native metadata exceeds the SQL value boundary");
  return result;
}
