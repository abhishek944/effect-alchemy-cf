import { RANGE_TYPE } from "@univerjs/core";
import {
  coordinate,
  integer,
  invalid,
  limited,
  record,
  type SheetDimensions,
  type SheetLoadBudget,
} from "./sheet-load-budget.ts";

const cellKeys = new Set(["p", "s", "v", "t", "f", "ft", "fd", "ref", "xf", "si", "custom"]);
const sheetKeys = new Set([
  "id",
  "name",
  "rowCount",
  "columnCount",
  "cellData",
  "tabColor",
  "hidden",
  "freeze",
  "zoomRatio",
  "scrollTop",
  "scrollLeft",
  "defaultColumnWidth",
  "defaultRowHeight",
  "mergeData",
  "rowData",
  "columnData",
  "rowHeader",
  "columnHeader",
  "showGridlines",
  "rightToLeft",
  "defaultStyle",
  "gridlinesColor",
  "custom",
  "backgroundImage",
]);
function emptyCustom(value: unknown): void {
  if (value !== undefined && value !== null && Object.keys(record(value)).length !== 0) invalid();
}
const normalKind: number = RANGE_TYPE.NORMAL;
const rowKind: number = RANGE_TYPE.ROW;
const columnKind: number = RANGE_TYPE.COLUMN;
function pixel(value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalid();
  if (value > 1_000_000) limited();
}
export function admitCells(
  value: unknown,
  dimensions: SheetDimensions,
  budget: SheetLoadBudget,
  rowRange?: { readonly start: number; readonly end: number },
  options?: { readonly historyStylePatches: true },
): void {
  if (value === undefined) return;
  for (const [row, cells] of Object.entries(record(value))) {
    const r = coordinate(row, dimensions.rows);
    if (rowRange && (r < rowRange.start || r > rowRange.end)) invalid();
    for (const column of Object.keys(record(cells))) {
      coordinate(column, dimensions.columns);
      budget.charge("sparse", 1);
      const cell = record(cells)[column];
      if (cell === null) continue;
      const data = record(cell);
      // Each non-null history patch can intern a distinct style, including repeated string refs.
      if (options?.historyStylePatches && Object.hasOwn(data, "s") && data.s !== null)
        budget.charge("styles", 1);
      if (Object.keys(data).some((key) => !cellKeys.has(key))) invalid();
      if (data.p !== undefined && data.p !== null) invalid();
      emptyCustom(data.custom);
      if (
        ["f", "si", "ft", "fd", "ref", "xf"].some(
          (key) => data[key] !== undefined && data[key] !== null && data[key] !== "",
        )
      )
        invalid();
    }
  }
}
/** No model/default merger is called; missing fields are admitted only at pinned SDK defaults. */
export function admitSheet(
  data: Record<string, unknown>,
  rows: unknown,
  columns: unknown,
  budget: SheetLoadBudget,
): SheetDimensions {
  if (Object.keys(data).some((key) => !sheetKeys.has(key))) invalid();
  if (data.backgroundImage !== undefined && data.backgroundImage !== null) invalid();
  emptyCustom(data.custom);
  const dimensions = { rows: integer(rows, 1), columns: integer(columns, 1) };
  if (dimensions.rows > 1_048_576 || dimensions.columns > 16_384) limited();
  budget.charge("sheets", 1);
  budget.charge("rows", dimensions.rows);
  budget.charge("columns", dimensions.columns);
  const merges = data.mergeData === undefined ? [] : data.mergeData;
  if (!Array.isArray(merges)) invalid();
  budget.charge("merges", merges.length);
  for (const item of merges) {
    const range = record(item);
    const startRow = integer(range.startRow, 0, dimensions.rows - 1);
    const endRow = integer(range.endRow, startRow, dimensions.rows - 1);
    const startColumn = integer(range.startColumn, 0, dimensions.columns - 1);
    const endColumn = integer(range.endColumn, startColumn, dimensions.columns - 1);
    const type = integer(
      range.rangeType === undefined ? RANGE_TYPE.NORMAL : range.rangeType,
      RANGE_TYPE.NORMAL,
      RANGE_TYPE.ALL,
    );
    const height = endRow - startRow + 1,
      width = endColumn - startColumn + 1;
    if (type === normalKind) {
      budget.product("mergeCells", height, width);
      budget.charge("mergeRows", height);
    } else budget.charge("mergeAxis", type === rowKind ? height : type === columnKind ? width : 1);
  }
  for (const [key, bound, fields] of [
    ["rowData", dimensions.rows, ["h", "ah"]],
    ["columnData", dimensions.columns, ["w"]],
  ] satisfies readonly [string, number, readonly string[]][]) {
    const axis = data[key] === undefined ? {} : record(data[key]);
    for (const [index, item] of Object.entries(axis)) {
      coordinate(index, bound);
      budget.charge("sparse", 1);
      const entry = record(item);
      if (
        Object.keys(entry).some(
          (property) => !["h", "ah", "ia", "hd", "w", "s", "custom"].includes(property),
        )
      )
        invalid();
      emptyCustom(entry.custom);
      for (const field of fields)
        if (entry[field] !== undefined && entry[field] !== null) pixel(entry[field]);
    }
  }
  if (data.freeze !== undefined) {
    const freeze = record(data.freeze);
    const x = integer(freeze.xSplit === undefined ? 0 : freeze.xSplit, 0, dimensions.columns);
    const y = integer(freeze.ySplit === undefined ? 0 : freeze.ySplit, 0, dimensions.rows);
    integer(
      freeze.startRow === undefined ? -1 : freeze.startRow,
      y === 0 ? -1 : 0,
      dimensions.rows - 1,
    );
    integer(
      freeze.startColumn === undefined ? -1 : freeze.startColumn,
      x === 0 ? -1 : 0,
      dimensions.columns - 1,
    );
  }
  for (const field of ["defaultRowHeight", "defaultColumnWidth", "scrollTop", "scrollLeft"])
    if (data[field] !== undefined) pixel(data[field]);
  if (data.zoomRatio !== undefined) {
    if (
      typeof data.zoomRatio !== "number" ||
      !Number.isFinite(data.zoomRatio) ||
      data.zoomRatio <= 0
    )
      invalid();
    if (data.zoomRatio > 10) limited();
  }
  for (const [key, field] of [
    ["rowHeader", "width"],
    ["columnHeader", "height"],
  ] satisfies readonly [string, string][])
    if (data[key] !== undefined) pixel(record(data[key])[field]);
  admitCells(data.cellData, dimensions, budget);
  return dimensions;
}
