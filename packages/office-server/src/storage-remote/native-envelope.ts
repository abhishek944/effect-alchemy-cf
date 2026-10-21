import { Schema } from "effect";
import { UniverType, type IChangeset, type ISheetBlock, type ISnapshot } from "@univerjs/protocol";
import { Count, Revision, decodeWireSync } from "@starter/office-contract";
import { decodeNativeFrame } from "@starter/office-contract/native-wire";
import { officeFailure } from "../core/failure.ts";
import { SnapshotWithBlocksSchema } from "../jobs/snapshot-schema.ts";

const Name = Schema.String.check(Schema.isMaxLength(256));
const NativeId = Name.check(Schema.isMinLength(1));
const Text = Schema.String.check(Schema.isMaxLength(8 * 1024 * 1024));
const Binary = Schema.Uint8Array.check(Schema.isMaxLength(128 * 1024 * 1024));
const Resource = Schema.Struct({
  id: Schema.optional(Schema.UndefinedOr(NativeId)),
  name: Name,
  data: Text,
});
const Resources = Schema.mutable(Schema.Array(Resource).check(Schema.isMaxLength(4096)));
const UnitMetaFields = {
  unitID: NativeId,
  rev: Revision,
  creator: Schema.optionalKey(Schema.UndefinedOr(Name)),
  name: Name,
  resources: Schema.optionalKey(Schema.UndefinedOr(Resources)),
  originalMeta: Binary,
};
const UnitMeta = Schema.Struct(UnitMetaFields);
const WorksheetMeta = Schema.Struct({
  type: Schema.optionalKey(Schema.UndefinedOr(Count)),
  id: NativeId,
  name: Name,
  rowCount: Count,
  columnCount: Count,
  originalMeta: Binary,
});
const BlockMeta = Schema.Struct({
  sheetID: Schema.optionalKey(Schema.UndefinedOr(NativeId)),
  blocks: Schema.mutable(Schema.Array(NativeId).check(Schema.isMaxLength(4096))),
});
const WorkbookMeta = Schema.Struct({
  ...UnitMetaFields,
  sheetOrder: Schema.mutable(Schema.Array(NativeId).check(Schema.isMaxLength(4096))),
  sheets: Schema.Record(NativeId, WorksheetMeta).check(Schema.isMaxProperties(4096)),
  blockMeta: Schema.Record(NativeId, BlockMeta).check(Schema.isMaxProperties(4096)),
});
/** Represented SDK payloads retain absent fields and extensions; finite wire DTOs stay separately strict. */
const SnapshotFields = Schema.Struct({
  unitID: NativeId,
  type: Schema.Literals([1, 2, 3]),
  rev: Revision,
  workbook: Schema.optionalKey(Schema.UndefinedOr(WorkbookMeta)),
  doc: Schema.optionalKey(Schema.UndefinedOr(UnitMeta)),
  slide: Schema.optionalKey(Schema.UndefinedOr(UnitMeta)),
  board: Schema.optionalKey(Schema.Undefined),
  pdf: Schema.optionalKey(Schema.Undefined),
});
const SnapshotEnvelope = Schema.declare<ISnapshot>(
  (value): value is ISnapshot =>
    Schema.is(SnapshotFields)(value) &&
    Schema.is(SnapshotWithBlocksSchema)({ snapshot: value, sheetBlocks: [] }),
);
const BlockFields = Schema.Struct({
  id: NativeId,
  startRow: Count,
  endRow: Count,
  data: Schema.Uint8Array.check(Schema.isMaxLength(8 * 1024 * 1024)),
});
const BlockEnvelope = Schema.declare<ISheetBlock>((value): value is ISheetBlock =>
  Schema.is(BlockFields)(value),
);
const MutationEnvelope = Schema.Struct({ id: NativeId, data: Text });
export const ChangesetEnvelope = Schema.Struct({
  unitID: NativeId,
  type: Schema.Literals([1, 2, 3]),
  baseRev: Revision,
  revision: Revision,
  userID: NativeId,
  memberID: NativeId,
  mutations: Schema.mutable(Schema.Array(MutationEnvelope).check(Schema.isMaxLength(20_000))),
  sid: Schema.optional(Schema.UndefinedOr(NativeId)),
  reqId: Schema.optional(Schema.UndefinedOr(Count)),
  mutationSize: Schema.optional(Schema.UndefinedOr(Count)),
  additionalFields: Schema.optional(Schema.UndefinedOr(Text)),
  createTime: Schema.optional(Schema.UndefinedOr(Count)),
});
export type SnapshotIdentity = {
  readonly unitID: string;
  readonly type: number;
  readonly revision: number;
};
export function decodeSnapshot(bytes: Uint8Array, expected: SnapshotIdentity): ISnapshot {
  const snapshot = decodeWireSync(SnapshotEnvelope)(decodeNativeFrame(bytes, "snapshot").payload);
  const body =
    snapshot.type === UniverType.UNIVER_DOC
      ? snapshot.doc
      : snapshot.type === UniverType.UNIVER_SHEET
        ? snapshot.workbook
        : snapshot.slide;
  if (
    snapshot.unitID !== expected.unitID ||
    String(snapshot.type) !== String(expected.type) ||
    snapshot.rev !== expected.revision ||
    body === undefined ||
    body.unitID !== snapshot.unitID ||
    body.rev !== snapshot.rev ||
    (snapshot.type !== UniverType.UNIVER_DOC && snapshot.doc !== undefined) ||
    (snapshot.type !== UniverType.UNIVER_SHEET && snapshot.workbook !== undefined) ||
    (snapshot.type !== UniverType.UNIVER_SLIDE && snapshot.slide !== undefined)
  )
    throw officeFailure("CONTENT_REQUIRED");
  return snapshot;
}
export function decodeBlock(bytes: Uint8Array, blockID: string): ISheetBlock {
  const block = decodeWireSync(BlockEnvelope)(decodeNativeFrame(bytes, "block").payload);
  if (block.id !== blockID || block.endRow < block.startRow)
    throw officeFailure("CONTENT_REQUIRED");
  return block;
}
export type ChangesetIdentity = {
  readonly unitID: string;
  readonly type: number;
  readonly revision: number;
  readonly baseRev: number;
  readonly sid: string | null;
  readonly reqId: number | null;
};
export function decodeChangeset(bytes: Uint8Array, expected: ChangesetIdentity): IChangeset {
  const change = decodeWireSync(ChangesetEnvelope)(decodeNativeFrame(bytes, "changeset").payload);
  if (
    change.unitID !== expected.unitID ||
    change.type !== expected.type ||
    change.revision !== expected.revision ||
    change.baseRev !== expected.baseRev ||
    change.revision !== change.baseRev + 1 ||
    (change.sid ?? null) !== expected.sid ||
    (change.reqId ?? null) !== expected.reqId
  )
    throw officeFailure("CONTENT_REQUIRED");
  return change;
}
