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
export const NATIVE_WIRE_LIMITS: NativeWireLimits = Object.freeze({});
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
  for (const value of Object.values(limits)) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
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
    const measurement = { depth: 0 };
    validateNativeValue(frame, limits, measurement);
    const bytes = encode(liftNativeUndefined(frame), {
      maxDepth: measurement.depth + 1,
      extensionCodec: nativeExtensionCodec,
      forceIntegerToFloat: true,
    });
    if (limits.maxBytes !== undefined && bytes.byteLength > limits.maxBytes)
      throw new NativeWireError("LIMIT_EXCEEDED");
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
      ...(limits.maxStringBytes === undefined ? {} : { maxStrLength: limits.maxStringBytes }),
      ...(limits.maxBinaryBytes === undefined ? {} : { maxBinLength: limits.maxBinaryBytes }),
      ...(limits.maxArrayLength === undefined ? {} : { maxArrayLength: limits.maxArrayLength }),
      ...(limits.maxMapLength === undefined ? {} : { maxMapLength: limits.maxMapLength }),
      maxExtLength: 0,
      extensionCodec: nativeExtensionCodec,
    });
    if (!Predicate.isObject(decoded) || !Object.hasOwn(decoded, "payload"))
      throw new NativeWireError("INVALID_FRAME");
    const frame = decodeWireSync(Envelope)(decoded);
    if (frame.kind !== expectedKind) throw new NativeWireError("INVALID_FRAME");
    const payload = frame.payload;
    validateNativeValue(payload, limits);
    return { format: NATIVE_WIRE_FORMAT, version: 1, kind: frame.kind, payload };
  } catch (error) {
    throw error instanceof NativeWireError ? error : new NativeWireError("INVALID_FRAME");
  }
}
