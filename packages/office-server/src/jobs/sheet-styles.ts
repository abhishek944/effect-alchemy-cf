import { Predicate } from "effect";
import {
  Styles,
  Worksheet,
  Tools,
  composeStyles,
  type IStyleData,
  type IWorkbookData,
  type IWorksheetData,
  type Nullable,
} from "@univerjs/core";
import {
  OfficeConflict,
  OfficeInvalid,
  OfficeLimited,
  safeFailure,
} from "@starter/office-contract";

type Style = string | Nullable<IStyleData>;
const MAX_STYLES = 4096;
/** Only documented native style slots are remapped, never a guessed plugin/resource graph. */
export function prepareSheetStyles(
  source: IWorkbookData,
  target: IWorkbookData,
  sheets: readonly IWorksheetData[],
): { readonly sheets: readonly IWorksheetData[]; readonly styles: Record<string, IStyleData> } {
  if (
    Object.keys(source.styles).length > MAX_STYLES ||
    Object.keys(target.styles).length > MAX_STYLES
  )
    throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
  const from = new Styles(source.styles),
    into = new Styles(Tools.deepClone(target.styles));
  const added = new Map<string, IStyleData>();
  const resolve = (style: Style) => {
    if (typeof style === "string" && !Object.hasOwn(source.styles, style))
      throw new OfficeInvalid(safeFailure("CONTENT_REQUIRED"));
    const value = from.get(style);
    if (
      value !== undefined &&
      value !== null &&
      (!Predicate.isObject(value) || Array.isArray(value))
    )
      throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
    return value;
  };
  const intern = (style: Style): string | null => {
    const value = resolve(style);
    const id = into.setValue(value) ?? null;
    if (id !== null) {
      if (value === null || value === undefined || !Tools.diffValue(value, into.get(id)))
        throw new OfficeInvalid(safeFailure("CONTENT_REQUIRED"));
      if (Object.hasOwn(target.styles, id)) {
        if (!Tools.diffValue(target.styles[id], into.get(id)))
          throw new OfficeConflict(safeFailure("NATIVE_CONFLICT"));
      } else {
        if (added.has(id) && !Tools.diffValue(added.get(id), value))
          throw new OfficeConflict(safeFailure("NATIVE_CONFLICT"));
        added.set(id, value);
      }
      if (added.size > MAX_STYLES) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
    }
    return id;
  };
  const mapped = sheets.map((sheet) => {
    const model = new Worksheet(target.id, Tools.deepClone(sheet), from);
    // Keep source fallback local to the new worksheet; never change target workbook defaults.
    model.setDefaultCellStyle(
      intern(composeStyles(resolve(source.defaultStyle), resolve(model.getDefaultCellStyle()))),
    );
    for (const row of Object.keys(model.getSnapshot().rowData)) {
      const value = model.getRowManager().getRowStyle(Number(row));
      if (value !== undefined) model.setRowStyle(Number(row), intern(value));
    }
    for (const column of Object.keys(model.getSnapshot().columnData)) {
      const value = model.getColumnManager().getColumnStyle(Number(column));
      if (value !== undefined) model.setColumnStyle(Number(column), intern(value));
    }
    model.getCellMatrix().forValue((row, column, cell) => {
      if (cell && cell.s !== undefined) {
        const copy = Tools.deepClone(cell);
        copy.s = intern(cell.s);
        model.getCellMatrix().setValue(row, column, copy);
      }
    });
    return model.getSnapshot();
  });
  return { sheets: mapped, styles: Object.fromEntries(added) };
}
