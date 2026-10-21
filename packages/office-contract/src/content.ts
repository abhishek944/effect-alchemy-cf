import { Schema } from "effect";
import { Count, Cursor, Id, Label, Scalar } from "./primitives.ts";

const NativeId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Ids = Schema.Array(NativeId).check(Schema.isMinLength(1), Schema.isMaxLength(32));
export const InspectQuery = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("workbook") }),
  Schema.Struct({ kind: Schema.Literal("worksheet"), worksheetId: NativeId }),
  Schema.Struct({
    kind: Schema.Literal("range"),
    worksheetId: NativeId,
    range: Schema.String.check(Schema.isMaxLength(64)),
  }),
  Schema.Struct({ kind: Schema.Literal("document") }),
  Schema.Struct({ kind: Schema.Literal("paragraphs"), ids: Ids }),
  Schema.Struct({ kind: Schema.Literal("presentation") }),
  Schema.Struct({ kind: Schema.Literal("slides"), ids: Ids }),
]);
export type InspectQuery = typeof InspectQuery.Type;
export const InspectRequest = Schema.Struct({ viewId: Id, query: InspectQuery, cursor: Cursor });
export type InspectRequest = typeof InspectRequest.Type;
export const InspectionEntry = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("summary"), id: NativeId, name: Label, count: Count }),
  Schema.Struct({
    kind: Schema.Literal("cell"),
    sheetId: NativeId,
    a1: Label,
    value: Scalar,
    formula: Schema.NullOr(Label),
  }),
  Schema.Struct({
    kind: Schema.Literal("text"),
    id: NativeId,
    index: Count,
    text: Schema.String.check(Schema.isMaxLength(16_384)),
  }),
]);
export const Inspection = Schema.Struct({
  viewId: Id,
  entries: Schema.Array(InspectionEntry).check(Schema.isMaxLength(1000)),
  next: Cursor,
  complete: Schema.Boolean,
});
export type Inspection = typeof Inspection.Type;
