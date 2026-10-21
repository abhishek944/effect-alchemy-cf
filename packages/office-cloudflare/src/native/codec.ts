import {
  decodeNativeFrame,
  encodeNativeFrame,
  NativeWireError,
} from "@starter/office-contract/native-wire";
import { NativeStorageError } from "./types.ts";
import type { NativePayloadKind } from "./types.ts";

/** Pre-release storage format: office-native-msgpack envelope v1, shared with the Node broker. */
export function encodeNativePayload(kind: NativePayloadKind, value: unknown): Uint8Array {
  try {
    return encodeNativeFrame(kind, value);
  } catch (cause) {
    throw storageCodecError(cause);
  }
}
export function decodeNativePayload(kind: NativePayloadKind, bytes: Uint8Array): unknown {
  try {
    return decodeNativeFrame(bytes, kind).payload;
  } catch (cause) {
    throw storageCodecError(cause);
  }
}
function storageCodecError(cause: unknown): NativeStorageError {
  if (!(cause instanceof NativeWireError))
    return new NativeStorageError("CONTENT", "Native payload codec failed");
  return new NativeStorageError(
    cause.code === "LIMIT_EXCEEDED" ? "LIMIT" : "CONTENT",
    cause.message,
  );
}
