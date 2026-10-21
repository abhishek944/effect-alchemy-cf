import { Schema } from "effect";
import { Count } from "@starter/office-contract";
import { UniverType } from "@univerjs/protocol";
import type { ISnapshotWithBlocks } from "@univerjs-pro/collaboration-service";

const NativeId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Resource = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.String,
  data: Schema.String,
});
const Metadata = Schema.Struct({
  unitID: NativeId,
  rev: Count,
  name: Schema.String,
  originalMeta: Schema.Uint8Array,
  creator: Schema.optional(Schema.String),
  resources: Schema.optional(Schema.Array(Resource)),
});
const Worksheet = Schema.Struct({
  type: Schema.optional(Schema.Number),
  id: NativeId,
  name: Schema.String,
  rowCount: Count,
  columnCount: Count,
  originalMeta: Schema.Uint8Array,
});
const Workbook = Schema.Struct({
  ...Metadata.fields,
  sheetOrder: Schema.Array(NativeId),
  sheets: Schema.Record(Schema.String, Worksheet),
  blockMeta: Schema.Record(
    Schema.String,
    Schema.Struct({ sheetID: Schema.optional(NativeId), blocks: Schema.Array(NativeId) }),
  ),
});
const Envelope = Schema.Struct({
  snapshot: Schema.Struct({
    unitID: NativeId,
    rev: Count,
    type: Schema.Literals([
      UniverType.UNIVER_SHEET,
      UniverType.UNIVER_DOC,
      UniverType.UNIVER_SLIDE,
    ]),
    workbook: Schema.optional(Workbook),
    doc: Schema.optional(Metadata),
    slide: Schema.optional(Metadata),
    board: Schema.optionalKey(Schema.Undefined),
    pdf: Schema.optionalKey(Schema.Undefined),
  }),
  sheetBlocks: Schema.Array(
    Schema.Struct({
      id: NativeId,
      startRow: Count,
      endRow: Count,
      data: Schema.Uint8Array,
    }),
  ).check(Schema.isMaxLength(4096)),
});
/**
 * Foreign SDK content, not a replacement protocol model. Actual 1.0.3 Exchange output omits
 * protobuf-default worksheet.type / Doc creator and extends Slide metadata with id.
 * Validate represented identity/binary/dependency fields but preserve every byte and omitted key.
 * Codec limits and requireSnapshot enforce the application envelope; the clean SDK MUST still
 * materialize/apply native content. This declaration alone is not semantic acceptance or authority.
 */
export const SnapshotWithBlocksSchema = Schema.declare<ISnapshotWithBlocks>(
  (value): value is ISnapshotWithBlocks => Schema.is(Envelope)(value),
);
