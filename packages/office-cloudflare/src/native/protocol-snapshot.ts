import { Predicate, Schema } from "effect";
import type { ISnapshot } from "@univerjs/protocol";
import {
  NativeName,
  NativeType,
  Natural,
  boundedArray,
  objectFields,
  parseMetadata,
} from "./metadata-parse.ts";
import { NativeStorageError, nativeLimits } from "./types.ts";
const Envelope = Schema.Struct({
  unitID: NativeName,
  type: NativeType,
  rev: Natural.check(Schema.isGreaterThanOrEqualTo(1)),
});
const Identity = Schema.Struct({ unitID: NativeName, rev: Natural });
const BlockMeta = Schema.Struct({
  blocks: Schema.Array(NativeName).check(Schema.isMaxLength(nativeLimits.blocks)),
});
function nativeRecord(input: unknown): Record<string, unknown> {
  if (!Predicate.isObject(input))
    throw new NativeStorageError("CONTENT", "Native SDK field must be a plain record");
  // Native content is not a finite ref/record DTO. Keep SDK extension fields, but reject accessors/classes.
  return objectFields(input, Object.keys(input));
}
function represented(schema: Schema.ConstraintDecoder<unknown>, value: unknown): void {
  if (value !== undefined) parseMetadata(schema, value);
}
function checkSnapshot(input: unknown): void {
  const value = nativeRecord(input),
    header = parseMetadata(Envelope, { unitID: value.unitID, type: value.type, rev: value.rev });
  const active = header.type === 1 ? "doc" : header.type === 2 ? "workbook" : "slide",
    meta = nativeRecord(value[active]);
  const identity = parseMetadata(Identity, { unitID: meta.unitID, rev: meta.rev });
  if (
    identity.unitID !== header.unitID ||
    identity.rev !== header.rev ||
    ["doc", "workbook", "slide", "board", "pdf"].some(
      (key) => key !== active && value[key] !== undefined,
    )
  )
    throw new NativeStorageError("CONTENT", "Native snapshot identity/header mismatch");
  parseMetadata(Schema.Uint8Array, meta.originalMeta);
  represented(Schema.String, meta.creator);
  represented(Schema.String, meta.name);
  if (meta.resources !== undefined) boundedArray(meta.resources, 100000);
  if (
    active === "slide" &&
    meta.id !== undefined &&
    parseMetadata(NativeName, meta.id) !== header.unitID
  )
    throw new NativeStorageError("CONTENT", "Native Slide identity mismatch");
  if (active !== "workbook") return;
  const sheets = nativeRecord(meta.sheets),
    blocks = nativeRecord(meta.blockMeta);
  for (const id of boundedArray(meta.sheetOrder, 4096)) {
    const sheetId = parseMetadata(NativeName, id),
      sheet = nativeRecord(sheets[sheetId]);
    if (parseMetadata(NativeName, sheet.id) !== sheetId)
      throw new NativeStorageError("CONTENT", "Native worksheet identity mismatch");
    represented(Natural, sheet.type);
    represented(Schema.String, sheet.name);
    represented(Natural, sheet.rowCount);
    represented(Natural, sheet.columnCount);
    parseMetadata(Schema.Uint8Array, sheet.originalMeta);
  }
  for (const [id, metadata] of Object.entries(blocks)) {
    const block = nativeRecord(metadata),
      sheetId = parseMetadata(NativeName, id);
    parseMetadata(BlockMeta, { blocks: block.blocks });
    if (
      !Object.hasOwn(sheets, sheetId) ||
      (block.sheetID !== undefined && parseMetadata(NativeName, block.sheetID) !== sheetId)
    )
      throw new NativeStorageError("CONTENT", "Native block worksheet identity mismatch");
  }
}
/** SDK 1.0.3's runtime protocol omits fields its .d.ts marks required. Validate its represented envelope,
 * not a replacement workbook model. Provenance and the safe native wire are checked separately; return ORIGINAL bytes/fields.
 */
const Snapshot = Schema.declare<ISnapshot>((input): input is ISnapshot => {
  try {
    checkSnapshot(input);
    return true;
  } catch {
    return false;
  }
});
export function readNativeSnapshot(input: unknown): ISnapshot {
  return parseMetadata(Snapshot, input);
}
