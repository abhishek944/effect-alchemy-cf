import { Schema } from "effect";
import { NATIVE_WIRE_CODEC } from "@starter/office-contract/native-wire";
import type {
  NativePieceRef,
  NativeValueRef,
  NativeSnapshotRefs,
  NativeChangesetRef,
} from "./types.ts";
import { nativeLimits, NativeStorageError } from "./types.ts";
import {
  boundedArray,
  NativeName,
  NativeType,
  Natural,
  objectFields,
  parseMetadata,
} from "./metadata-parse.ts";

export const Piece = Schema.Struct({
  key: NativeName,
  digest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  bytes: Natural.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(nativeLimits.pieceBytes),
  ),
});
export const Value = Schema.Struct({
  codec: Schema.Literal(NATIVE_WIRE_CODEC),
  kind: Schema.Literals(["snapshot", "block", "changeset"]),
  bytes: Natural.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(nativeLimits.aggregateBytes),
  ),
  parts: Schema.Array(Piece),
});
export const Snapshot = Schema.Struct({
  unitID: NativeName,
  type: NativeType,
  revision: Natural,
  snapshot: Value,
  blocks: Schema.Array(Schema.Struct({ blockID: NativeName, value: Value })),
});
const Changeset = Schema.Struct({
  unitID: NativeName,
  type: NativeType,
  baseRev: Natural,
  revision: Natural,
  sid: Schema.optional(NativeName),
  reqId: Schema.optional(Natural),
  value: Value,
});
export function readPiece(input: unknown): NativePieceRef {
  return parseMetadata(Piece, objectFields(input, ["key", "digest", "bytes"]));
}
export function readValue(input: unknown): NativeValueRef {
  const object = objectFields(input, ["codec", "kind", "bytes", "parts"]);
  if (object.codec !== NATIVE_WIRE_CODEC)
    throw new NativeStorageError("VERSION", "Incompatible native value codec");
  const parts = boundedArray(object.parts, nativeLimits.parts).map(readPiece);
  const value = parseMetadata(Value, {
    codec: object.codec,
    kind: object.kind,
    bytes: object.bytes,
    parts,
  });
  if (
    !parts.length ||
    value.bytes !== parts.reduce((bytes, part) => bytes + part.bytes, 0) ||
    parts.some((part, index) => index < parts.length - 1 && part.bytes !== nativeLimits.pieceBytes)
  ) {
    throw new NativeStorageError("CONTENT", "Invalid native part lengths");
  }
  return value;
}
export function readSnapshotRefs(input: unknown): NativeSnapshotRefs {
  const object = objectFields(input, ["unitID", "type", "revision", "snapshot", "blocks"]);
  const snapshot = readValue(object.snapshot);
  let bytes = snapshot.bytes;
  const blocks = boundedArray(object.blocks, nativeLimits.blocks).map((inputBlock) => {
    const block = objectFields(inputBlock, ["blockID", "value"]);
    const value = readValue(block.value);
    bytes += value.bytes;
    if (bytes > nativeLimits.aggregateBytes)
      throw new NativeStorageError("LIMIT", "Native aggregate exceeds its limit");
    return { blockID: parseMetadata(NativeName, block.blockID), value };
  });
  return parseMetadata(Snapshot, {
    unitID: object.unitID,
    type: object.type,
    revision: object.revision,
    snapshot,
    blocks,
  });
}
export function readChangesetRef(input: unknown): NativeChangesetRef {
  const object = objectFields(input, [
    "unitID",
    "type",
    "baseRev",
    "revision",
    "sid",
    "reqId",
    "value",
  ]);
  return parseMetadata(Changeset, { ...object, value: readValue(object.value) });
}
