import { forbiddenNativeKey, NativeWireError, type NativeWireLimits } from "./native-value.ts";

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
const invalid = (): never => {
  throw new NativeWireError("INVALID_FRAME");
};
type Container = { remaining: number; map: boolean; key: boolean; keys: Set<string> };
/** Scan lengths/depth/nodes/keys BEFORE MessagePack allocates decoded arrays/maps/binaries. */
export function scanNativeMessagePack(bytes: Uint8Array, limits: NativeWireLimits): void {
  if (bytes.byteLength === 0 || bytes.byteLength > limits.maxBytes)
    throw new NativeWireError("LIMIT_EXCEEDED");
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stack: Container[] = [{ remaining: 1, map: false, key: false, keys: new Set() }];
  let pos = 0;
  let nodes = 0;
  const take = (size: number): number => {
    if (!Number.isSafeInteger(size) || size < 0 || size > bytes.length - pos) return invalid();
    const start = pos;
    pos += size;
    return start;
  };
  const length = (width: 1 | 2 | 4): number => {
    const at = take(width);
    return width === 1 ? data.getUint8(at) : width === 2 ? data.getUint16(at) : data.getUint32(at);
  };
  while (stack.length > 0) {
    const parent = stack[stack.length - 1];
    if (parent === undefined) break;
    if (parent.remaining === 0) {
      stack.pop();
      continue;
    }
    if (++nodes > limits.maxNodes || stack.length - 1 > limits.maxDepth)
      throw new NativeWireError("LIMIT_EXCEEDED");
    const isKey = parent.map && parent.key;
    parent.remaining--;
    if (parent.map) parent.key = !parent.key;
    const tag = data.getUint8(take(1));
    let stringLength: number | null = null;
    let binaryLength: number | null = null;
    let count: number | null = null;
    let map = false;
    if (tag === 0xc7) {
      if (isKey || length(1) !== 0 || length(1) !== 1) invalid();
      continue; // The only supported extension is v1 explicit undefined.
    }
    if (tag <= 0x7f || tag >= 0xe0 || tag === 0xc0 || tag === 0xc2 || tag === 0xc3) {
      if (isKey) invalid();
      continue;
    }
    if ((tag & 0xe0) === 0xa0) stringLength = tag & 0x1f;
    else if ((tag & 0xf0) === 0x90) count = tag & 0x0f;
    else if ((tag & 0xf0) === 0x80) {
      count = tag & 0x0f;
      map = true;
    } else if (tag === 0xd9) stringLength = length(1);
    else if (tag === 0xda) stringLength = length(2);
    else if (tag === 0xdb) stringLength = length(4);
    else if (tag === 0xc4) binaryLength = length(1);
    else if (tag === 0xc5) binaryLength = length(2);
    else if (tag === 0xc6) binaryLength = length(4);
    else if (tag === 0xdc) count = length(2);
    else if (tag === 0xdd) count = length(4);
    else if (tag === 0xde) {
      count = length(2);
      map = true;
    } else if (tag === 0xdf) {
      count = length(4);
      map = true;
    } else {
      if (isKey) invalid();
      const width =
        tag === 0xcc || tag === 0xd0
          ? 1
          : tag === 0xcd || tag === 0xd1
            ? 2
            : tag === 0xce || tag === 0xd2 || tag === 0xca
              ? 4
              : tag === 0xcf || tag === 0xd3 || tag === 0xcb
                ? 8
                : 0;
      if (width === 0) invalid(); // Reject extensions, dates and reserved tags.
      const at = take(width);
      if (tag === 0xcf || tag === 0xd3) {
        const n = tag === 0xcf ? data.getBigUint64(at) : data.getBigInt64(at);
        if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) invalid();
      }
      continue;
    }
    if (stringLength !== null) {
      if (stringLength > limits.maxStringBytes) throw new NativeWireError("LIMIT_EXCEEDED");
      const start = take(stringLength);
      const text = utf8.decode(bytes.subarray(start, start + stringLength));
      if (isKey) {
        if (forbiddenNativeKey(text) || parent.keys.has(text)) invalid();
        parent.keys.add(text);
      }
    } else if (binaryLength !== null) {
      if (isKey) invalid();
      if (binaryLength > limits.maxBinaryBytes) throw new NativeWireError("LIMIT_EXCEEDED");
      take(binaryLength);
    } else if (count !== null) {
      if (isKey) invalid();
      if (count > (map ? limits.maxMapLength : limits.maxArrayLength))
        throw new NativeWireError("LIMIT_EXCEEDED");
      const remaining = count * (map ? 2 : 1);
      if (remaining > limits.maxNodes - nodes) throw new NativeWireError("LIMIT_EXCEEDED");
      stack.push({ remaining, map, key: map, keys: new Set() });
    }
  }
  if (pos !== bytes.length) invalid();
}
