import { ExtensionCodec } from "@msgpack/msgpack";
import { Array as Arr } from "effect";
import type { NativeValue } from "./native-value.ts";
import { NativeWireError } from "./native-value.ts";

/** v1 private extension: ext8, length=0, type=1 means explicit JavaScript undefined. */
export const NATIVE_UNDEFINED_EXTENSION = 1;
const undefinedToken = Object.freeze({ marker: Symbol("office.native.undefined") });
export const nativeExtensionCodec = new ExtensionCodec();
nativeExtensionCodec.register({
  type: NATIVE_UNDEFINED_EXTENSION,
  encode: (input) => (input === undefinedToken ? new Uint8Array(0) : null),
  decode: (bytes) => {
    if (bytes.length !== 0) throw new NativeWireError("INVALID_FRAME");
    return undefined;
  },
});
/** Runs only after bounded validation. Preserves absent versus own-undefined properties. */
export function liftNativeUndefined(value: NativeValue): unknown {
  if (value === undefined) return undefinedToken;
  if (value === null || typeof value !== "object" || value instanceof Uint8Array) return value;
  if (Arr.isArray<NativeValue>(value)) return value.map(liftNativeUndefined);
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    output[key] = liftNativeUndefined(value[key]);
  }
  return output;
}
