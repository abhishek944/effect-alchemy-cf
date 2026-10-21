import { nativeLimits, NativeStorageError } from "./types.ts";

/** Only normalized finite metadata DTOs belong here, never SDK content/context. */
export function metadata(value: unknown, limit: number = nativeLimits.metadataBytes): string {
  const stack: { value: unknown; depth: number; exit?: object }[] = [{ value, depth: 0 }];
  const active = new Set<object>();
  const encoder = new TextEncoder();
  let bytes = 0;
  const add = (count: number) => {
    bytes += count;
    if (bytes > limit)
      throw new NativeStorageError("LIMIT", "Native metadata exceeds its byte limit");
  };
  while (stack.length) {
    const next = stack.pop();
    if (!next) break;
    if (next.exit) {
      active.delete(next.exit);
      continue;
    }
    if (next.depth > 32)
      throw new NativeStorageError("LIMIT", "Native metadata nesting exceeds its limit");
    const item = next.value;
    if (item === undefined || item === null) {
      add(4);
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item))
        throw new NativeStorageError("CONTENT", "Nonfinite metadata number");
      add(String(item).length);
      continue;
    }
    if (typeof item === "boolean") {
      add(5);
      continue;
    }
    if (typeof item === "string") {
      if (item.length > limit)
        throw new NativeStorageError("LIMIT", "Metadata string exceeds its limit");
      add(encoder.encode(item).length + 2);
      continue;
    }
    if (typeof item !== "object")
      throw new NativeStorageError("CONTENT", "Unsupported native metadata value");
    const prototype: unknown = Object.getPrototypeOf(item);
    if (
      (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) ||
      active.has(item)
    ) {
      throw new NativeStorageError("CONTENT", "Metadata classes/cycles are not supported");
    }
    active.add(item);
    stack.push({ value: null, depth: 0, exit: item });
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (Array.isArray(item) && key === "length") continue;
      if (typeof key !== "string")
        throw new NativeStorageError("CONTENT", "Metadata symbols are unsupported");
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
        throw new NativeStorageError("CONTENT", "Metadata accessors are unsupported");
      add(encoder.encode(key).length + 4);
      stack.push({ value: descriptor.value, depth: next.depth + 1 });
    }
    add(2);
  }
  const result = JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
  if (!result || encoder.encode(result).length > limit)
    throw new NativeStorageError("LIMIT", "Native metadata exceeds its byte limit");
  return result;
}
