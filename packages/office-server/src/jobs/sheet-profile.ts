import { Predicate } from "effect";
import { Tools, mergeWorksheetSnapshotWithDefault, type IWorkbookData } from "@univerjs/core";
import { OfficeInvalid, safeFailure } from "@starter/office-contract";
import { noExternalGraphics } from "./mutation-policy.ts";
import { requireEmptySheetResources } from "./sheet-resources.ts";

const hasValue = (value: unknown) => value !== null && value !== undefined;
const sheetKeys = new Set([
  "id",
  "name",
  "tabColor",
  "hidden",
  "freeze",
  "rowCount",
  "columnCount",
  "zoomRatio",
  "scrollTop",
  "scrollLeft",
  "defaultColumnWidth",
  "defaultRowHeight",
  "mergeData",
  "cellData",
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
const cellKeys = new Set(["p", "s", "v", "t", "f", "ft", "fd", "ref", "xf", "si", "custom"]);
const rowKeys = new Set(["h", "ia", "ah", "hd", "s", "custom"]);
const columnKeys = new Set(["w", "hd", "s", "custom"]);
const mergeKeys = new Set([
  "startRow",
  "startColumn",
  "endRow",
  "endColumn",
  "rangeType",
  "startAbsoluteRefType",
  "endAbsoluteRefType",
]);
const workbookKeys = new Set([
  "id",
  "rev",
  "name",
  "appVersion",
  "locale",
  "dateSystem",
  "styles",
  "sheetOrder",
  "sheets",
  "defaultStyle",
  "resources",
  "custom",
]);
function deny(): never {
  throw new OfficeInvalid(safeFailure("FORBIDDEN"));
}

export function requireSheetProfile(source: IWorkbookData): void {
  requireEmptySheetResources(source.resources);
  for (const key of Object.keys(source)) {
    const value: unknown = Reflect.get(source, key);
    if (!workbookKeys.has(key)) deny();
    // ORIGINAL root resources have a separate strict semantic proof. No sanitized model is made.
    if (key !== "resources") noExternalGraphics({ [key]: value });
  }
  const stack: unknown[] = [source];
  while (stack.length) {
    const value = stack.pop();
    if (!Predicate.isObject(value)) continue;
    for (const [key, child] of Object.entries(value)) {
      if (
        ["f", "si", "ft", "fd", "ref", "xf", "theme", "th"].includes(key) &&
        hasValue(child) &&
        child !== ""
      )
        deny();
      if (
        key === "custom" &&
        hasValue(child) &&
        (!Predicate.isObject(child) || Array.isArray(child) || Object.keys(child).length !== 0)
      )
        deny();
      if (
        (key === "s" || key === "defaultStyle") &&
        typeof child === "string" &&
        !Object.hasOwn(source.styles, child)
      )
        deny();
      stack.push(child);
    }
  }
}
function keys(value: unknown, allowed: ReadonlySet<string>): void {
  if (
    !Predicate.isObject(value) ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.has(key))
  )
    deny();
}
function index(key: string, bound: number): void {
  if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= bound) deny();
}
/** Actual SDK default completion, not a handwritten worksheet snapshot model. */
export function checkedImportSheet(source: IWorkbookData, id: string) {
  const raw = source.sheets[id];
  if (!raw || raw.id !== id || !raw.name || Object.keys(raw).some((key) => !sheetKeys.has(key)))
    deny();
  if (raw.backgroundImage !== undefined && raw.backgroundImage !== null) deny();
  const sheet = mergeWorksheetSnapshotWithDefault(Tools.deepClone(raw));
  keys(sheet.freeze, new Set(["xSplit", "ySplit", "startRow", "startColumn"]));
  keys(sheet.rowHeader, new Set(["width", "hidden"]));
  keys(sheet.columnHeader, new Set(["height", "hidden"]));
  for (const merge of sheet.mergeData) keys(merge, mergeKeys);
  if (
    !Number.isSafeInteger(sheet.rowCount) ||
    sheet.rowCount < 1 ||
    !Number.isSafeInteger(sheet.columnCount) ||
    sheet.columnCount < 1
  )
    deny();
  for (const row of Object.keys(sheet.rowData)) {
    index(row, sheet.rowCount);
    keys(sheet.rowData[Number(row)], rowKeys);
  }
  for (const column of Object.keys(sheet.columnData)) {
    index(column, sheet.columnCount);
    keys(sheet.columnData[Number(column)], columnKeys);
  }
  for (const row of Object.keys(sheet.cellData)) {
    index(row, sheet.rowCount);
    const cells = sheet.cellData[Number(row)];
    if (!cells) deny();
    for (const column of Object.keys(cells)) {
      index(column, sheet.columnCount);
      const cell = cells[Number(column)];
      if (cell !== null && cell !== undefined) keys(cell, cellKeys);
    }
  }
  return sheet;
}
