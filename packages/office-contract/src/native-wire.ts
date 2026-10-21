import { decode, encode } from "@msgpack/msgpack";
import { Predicate, Schema } from "effect";
import { decodeWireSync } from "./primitives.ts";
import { scanNativeMessagePack } from "./native-scan.ts";
import { liftNativeUndefined, nativeExtensionCodec } from "./native-extension.ts";
export { NATIVE_UNDEFINED_EXTENSION } from "./native-extension.ts";
import {
  NativeWireError,
  validateNativeValue,
  type NativeValue,
  type NativeWireLimits,
} from "./native-value.ts";

export { NativeWireError };
export type { NativeValue, NativeWireLimits };
export const NATIVE_WIRE_FORMAT = "office-native-msgpack";
export const NATIVE_WIRE_VERSION = 1;
/** Reference metadata discriminator; the byte envelope also verifies format + version + kind. */
export const NATIVE_WIRE_CODEC = "office-native-msgpack-v1";
export const NativeFrameKind = Schema.Literals([
  "snapshot",
  "block",
  "changeset",
  "proposal",
  "job-input",
  "job-output",
  "merge-artifact",
]);
export type NativeFrameKind = typeof NativeFrameKind.Type;
export const NATIVE_WIRE_LIMITS: NativeWireLimits = Object.freeze({
  maxBytes: 128 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxArrayLength: 100_000,
  maxMapLength: 50_000,
  maxStringBytes: 8 * 1024 * 1024,
  maxBinaryBytes: 128 * 1024 * 1024,
});
export const NATIVE_WIRE_CEILINGS: NativeWireLimits = Object.freeze({
  maxBytes: 256 * 1024 * 1024,
  maxDepth: 96,
  maxNodes: 2_000_000,
  maxArrayLength: 200_000,
  maxMapLength: 100_000,
  maxStringBytes: 16 * 1024 * 1024,
  maxBinaryBytes: 256 * 1024 * 1024,
});
const Envelope = Schema.Struct({
  format: Schema.Literal(NATIVE_WIRE_FORMAT),
  version: Schema.Literal(NATIVE_WIRE_VERSION),
  kind: NativeFrameKind,
  payload: Schema.Unknown,
});
export type NativeFrame = {
  readonly format: typeof NATIVE_WIRE_FORMAT;
  readonly version: 1;
  readonly kind: NativeFrameKind;
  readonly payload: NativeValue;
};
const bounded = (limits: NativeWireLimits) => {
  for (const [key, ceiling] of Object.entries(NATIVE_WIRE_CEILINGS)) {
    const value: unknown = Reflect.get(limits, key);
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > ceiling)
      throw new NativeWireError("LIMIT_EXCEEDED");
  }
  return limits;
};
/**
 * Internal native artifact codec ONLY. Does not validate Univer semantics or grant write authority.
 * SDK owners validate frame payloads; never register this as an Office/model storage command.
 */
export function encodeNativeFrame(
  kind: NativeFrameKind,
  payload: unknown,
  limits: NativeWireLimits = NATIVE_WIRE_LIMITS,
): Uint8Array {
  try {
    bounded(limits);
    decodeWireSync(NativeFrameKind)(kind);
    const frame = { format: NATIVE_WIRE_FORMAT, version: NATIVE_WIRE_VERSION, kind, payload };
    validateNativeValue(frame, limits);
    const bytes = encode(liftNativeUndefined(frame), {
      maxDepth: limits.maxDepth + 1,
      extensionCodec: nativeExtensionCodec,
      forceIntegerToFloat: true,
    });
    if (bytes.byteLength > limits.maxBytes) throw new NativeWireError("LIMIT_EXCEEDED");
    return bytes;
  } catch (error) {
    throw error instanceof NativeWireError ? error : new NativeWireError("INVALID_FRAME");
  }
}
export function decodeNativeFrame(
  bytes: Uint8Array,
  expectedKind: NativeFrameKind,
  limits: NativeWireLimits = NATIVE_WIRE_LIMITS,
): NativeFrame {
  try {
    bounded(limits);
    scanNativeMessagePack(bytes, limits);
    const decoded = decode(bytes, {
      maxStrLength: limits.maxStringBytes,
      maxBinLength: limits.maxBinaryBytes,
      maxArrayLength: limits.maxArrayLength,
      maxMapLength: limits.maxMapLength,
      maxExtLength: 0,
      extensionCodec: nativeExtensionCodec,
    });
    if (!Predicate.isObject(decoded) || !Object.hasOwn(decoded, "payload"))
      throw new NativeWireError("INVALID_FRAME");
    const frame = decodeWireSync(Envelope)(decoded);
    if (frame.kind !== expectedKind) throw new NativeWireError("INVALID_FRAME");
    validateNativeValue(frame.payload, limits);
    return { format: NATIVE_WIRE_FORMAT, version: 1, kind: frame.kind, payload: frame.payload };
  } catch (error) {
    throw error instanceof NativeWireError ? error : new NativeWireError("INVALID_FRAME");
  }
}
