import type { InspectQuery } from "@starter/office-contract";
import { officeFailure } from "../failure.ts";
import type { InspectionNativeResult } from "./inspection.ts";

function exactIds(expected: readonly string[], actual: readonly string[]): void {
  if (
    new Set(expected).size !== expected.length ||
    new Set(actual).size !== actual.length ||
    actual.length !== expected.length ||
    actual.some((id) => !expected.includes(id))
  )
    throw officeFailure("CONTENT_REQUIRED");
}
export function requireInspectionSelectors(
  query: InspectQuery,
  result: InspectionNativeResult,
): void {
  switch (query.kind) {
    case "worksheet":
      if (result.kind !== "worksheet") throw officeFailure("CONTENT_REQUIRED");
      exactIds(
        [query.worksheetId],
        result.worksheets.map((sheet) => sheet.id),
      );
      return;
    case "range":
      if (
        result.kind !== "worksheet-range" ||
        result.ranges.some((range) => range.requestedRange !== query.range)
      )
        throw officeFailure("CONTENT_REQUIRED");
      exactIds(
        [query.worksheetId],
        result.ranges.map((range) => range.worksheet.id),
      );
      return;
    case "paragraphs":
      if (result.kind !== "paragraph") throw officeFailure("CONTENT_REQUIRED");
      exactIds(
        query.ids,
        result.paragraphs.map((paragraph) => paragraph.id),
      );
      return;
    case "slides":
      if (result.kind !== "slide") throw officeFailure("CONTENT_REQUIRED");
      exactIds(
        query.ids,
        result.slides.map((slide) => slide.id),
      );
      return;
    case "workbook":
    case "document":
    case "presentation":
      return;
  }
}
export function columnName(index: number): string {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}
const columnNumber = (letters: string) =>
  letters.split("").reduce((value, c) => value * 26 + c.charCodeAt(0) - 64, 0) - 1;
export function rangeBounds(range: string) {
  const match =
    /^\$?([A-Z]{1,4})\$?([1-9][0-9]{0,6})(?::\$?([A-Z]{1,4})\$?([1-9][0-9]{0,6}))?$/.exec(
      range.split("!").at(-1) ?? "",
    );
  const first = match?.[1],
    row = match?.[2];
  if (first === undefined || row === undefined) throw officeFailure("CONTENT_REQUIRED");
  const startColumn = columnNumber(first),
    startRow = Number(row) - 1;
  const endColumn = columnNumber(match?.[3] ?? first),
    endRow = Number(match?.[4] ?? row) - 1;
  if (endColumn < startColumn || endRow < startRow) throw officeFailure("CONTENT_REQUIRED");
  return { startColumn, startRow, endColumn, endRow };
}
