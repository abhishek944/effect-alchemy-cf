/** Compact row policy, independent of binary/file limits or image-count admission. */
export const MAX_IMAGE_RESPONSE_JSON_BYTES = 131_072;

/** Lower-bound preflight bounds traversal and the subsequent escaping allocation. */
function preflight(value: unknown, remaining: { bytes: number }, depth = 0): boolean {
  if (depth > 8 || --remaining.bytes < 0) return false;
  if (typeof value === "string") remaining.bytes -= value.length;
  else if (Array.isArray(value)) {
    if (value.length > remaining.bytes) return false;
    for (const item of value) if (!preflight(item, remaining, depth + 1)) return false;
  } else if (value !== null && typeof value === "object") {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const [key, item] of Object.entries(value)) {
      remaining.bytes -= key.length;
      if (!preflight(item, remaining, depth + 1)) return false;
    }
  } else if (value !== null && typeof value !== "number" && typeof value !== "boolean") {
    return false;
  }
  return remaining.bytes >= 0;
}

/** Only accepted bounded JSON is serialized; failures never expose its contents. */
export function isBoundedImageResponseJson(value: unknown): boolean {
  try {
    if (!preflight(value, { bytes: MAX_IMAGE_RESPONSE_JSON_BYTES })) return false;
    const json = JSON.stringify(value);
    return (
      typeof json === "string" &&
      new TextEncoder().encode(json).byteLength <= MAX_IMAGE_RESPONSE_JSON_BYTES
    );
  } catch {
    return false;
  }
}
