import { Schema } from "effect";
import { Count, InspectionEntry, Label, Scalar, decodeWireSync } from "@starter/office-contract";
import type { InspectQuery } from "@starter/office-contract";
import { officeFailure } from "../failure.ts";
import { columnName, rangeBounds, requireInspectionSelectors } from "./selectors.ts";

const NativeId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Text = Schema.String.check(Schema.isMaxLength(16_384));
const Worksheet = Schema.Struct({ id: NativeId, name: Label, rowCount: Count });
const Paragraph = Schema.Struct({ id: NativeId, index: Count, textPreview: Text });
const Slide = Schema.Struct({
  id: NativeId,
  index: Count,
  name: Label,
  elementCounts: Schema.Struct({ total: Count }),
});
const Element = Schema.Struct({
  id: NativeId,
  text: Schema.optional(Schema.Struct({ text: Text })),
  tableText: Schema.optional(Schema.Array(Schema.Array(Text))),
  children: Schema.optional(Schema.Array(Schema.Unknown)),
});
const Result = Schema.Union([
  Schema.Struct({
    kind: Schema.Literals(["workbook", "worksheet"]),
    unitId: NativeId,
    worksheets: Schema.Array(Worksheet),
  }),
  Schema.Struct({
    kind: Schema.Literal("worksheet-range"),
    unitId: NativeId,
    ranges: Schema.Array(
      Schema.Struct({
        clipped: Schema.Boolean,
        requestedRange: Label,
        resolvedRange: Label,
        worksheet: Schema.Struct({ id: NativeId }),
        cellData: Schema.Array(
          Schema.Array(
            Schema.NullOr(
              Schema.Struct({
                v: Schema.optional(Scalar),
                f: Schema.optional(Label),
              }),
            ),
          ),
        ),
        displayValues: Schema.Array(Schema.Array(Label)),
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("document"),
    unitId: NativeId,
    title: Label,
    paragraphCount: Count,
    paragraphs: Schema.Array(Paragraph),
  }),
  Schema.Struct({
    kind: Schema.Literal("paragraph"),
    unitId: NativeId,
    paragraphs: Schema.Array(Schema.Struct({ id: NativeId, index: Count, text: Text })),
  }),
  Schema.Struct({
    kind: Schema.Literal("presentation"),
    unitId: NativeId,
    slides: Schema.Array(Slide),
  }),
  Schema.Struct({
    kind: Schema.Literal("slide"),
    unitId: NativeId,
    slides: Schema.Array(
      Schema.Struct({
        ...Slide.fields,
        speakerNotes: Text,
        elements: Schema.Array(Schema.Unknown),
      }),
    ),
  }),
]);
type Entry = typeof InspectionEntry.Type;
export type InspectionNativeResult = typeof Result.Type;
/** Project genuine SDK results into the finite product read contract; never invent missing cells. */
export function inspectionEntries(raw: unknown, unitId: string, query: InspectQuery) {
  // Native SDK content has additional fields; only this projection ignores them, never job authority.
  const result = Schema.decodeUnknownSync(Result, { onExcessProperty: "ignore" })(raw);
  const expected =
    query.kind === "range"
      ? "worksheet-range"
      : query.kind === "paragraphs"
        ? "paragraph"
        : query.kind === "slides"
          ? "slide"
          : query.kind;
  if (result.unitId !== unitId || result.kind !== expected) throw officeFailure("CONTENT_REQUIRED");
  requireInspectionSelectors(query, result);
  const entries: Entry[] = [];
  let complete = true;
  const push = (entry: Entry) => {
    entries.push(decodeWireSync(InspectionEntry)(entry));
  };
  switch (result.kind) {
    case "workbook":
    case "worksheet":
      for (const sheet of result.worksheets)
        push({ kind: "summary", id: sheet.id, name: sheet.name, count: sheet.rowCount });
      break;
    case "document":
      push({ kind: "summary", id: unitId, name: result.title, count: result.paragraphCount });
      for (const paragraph of result.paragraphs)
        push({
          kind: "text",
          id: paragraph.id,
          index: paragraph.index,
          text: paragraph.textPreview,
        });
      break;
    case "paragraph":
      for (const paragraph of result.paragraphs) push({ kind: "text", ...paragraph });
      break;
    case "presentation":
      for (const slide of result.slides)
        push({ kind: "summary", id: slide.id, name: slide.name, count: slide.elementCounts.total });
      break;
    case "slide": {
      let nodes = 0;
      const visit = (rawElement: unknown, depth: number) => {
        if (depth > 16 || ++nodes > 1000) throw officeFailure("LIMIT_EXCEEDED");
        const element = Schema.decodeUnknownSync(Element, { onExcessProperty: "ignore" })(
          rawElement,
        );
        if (element.text !== undefined)
          push({ kind: "text", id: element.id, index: entries.length, text: element.text.text });
        if (element.tableText !== undefined)
          push({
            kind: "text",
            id: element.id,
            index: entries.length,
            text: element.tableText.map((row) => row.join("\t")).join("\n"),
          });
        for (const child of element.children ?? []) visit(child, depth + 1);
      };
      for (const slide of result.slides) {
        push({ kind: "summary", id: slide.id, name: slide.name, count: slide.elementCounts.total });
        for (const element of slide.elements) visit(element, 0);
        if (slide.speakerNotes !== "")
          push({ kind: "text", id: slide.id, index: slide.index, text: slide.speakerNotes });
      }
      break;
    }
    case "worksheet-range":
      for (const range of result.ranges) {
        if (range.clipped) complete = false;
        const bounds = rangeBounds(range.resolvedRange);
        if (
          !range.clipped &&
          (range.cellData.length !== bounds.endRow - bounds.startRow + 1 ||
            range.cellData.some((row) => row.length !== bounds.endColumn - bounds.startColumn + 1))
        )
          throw officeFailure("CONTENT_REQUIRED");
        if (
          range.displayValues.length !== range.cellData.length ||
          range.displayValues.some((row, index) => row.length !== range.cellData[index]?.length)
        )
          throw officeFailure("CONTENT_REQUIRED");
        for (const [rowIndex, row] of range.cellData.entries()) {
          if (bounds.startRow + rowIndex > bounds.endRow) throw officeFailure("CONTENT_REQUIRED");
          for (const [columnIndex, cell] of row.entries()) {
            const column = bounds.startColumn + columnIndex;
            if (column > bounds.endColumn) throw officeFailure("CONTENT_REQUIRED");
            push({
              kind: "cell",
              sheetId: range.worksheet.id,
              a1: columnName(column) + String(bounds.startRow + rowIndex + 1),
              value:
                cell?.v !== undefined
                  ? cell.v
                  : (range.displayValues[rowIndex]?.[columnIndex] ?? null),
              formula: cell?.f ?? null,
            });
          }
        }
      }
      break;
  }
  return { entries, complete };
}
