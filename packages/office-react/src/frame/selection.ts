import { MAX_OFFICE_SEND_RANGES, OfficeSheetSelection } from "@starter/office-contract";
import { Schema } from "effect";
import type { NativeApplication } from "./native.ts";

const decode = Schema.decodeUnknownSync(OfficeSheetSelection, { onExcessProperty: "error" });
/** Complete inclusive coordinates only; never silently omit ranges or select a foreign unit. */
export function captureSheetSelection(
  native: NativeApplication | null,
  unitId?: string,
): OfficeSheetSelection | null {
  if (native === null || typeof native.univerAPI.getActiveWorkbook !== "function") return null;
  try {
    const workbook =
      unitId === undefined
        ? native.univerAPI.getActiveWorkbook()
        : native.univerAPI.getWorkbook(unitId);
    if (
      !workbook ||
      (unitId !== undefined && native.univerAPI.getActiveWorkbook()?.getId() !== unitId)
    )
      return null;
    const sheet = workbook.getActiveSheet();
    if (!sheet) return null;
    const selected = sheet.getSelection()?.getActiveRangeList() ?? [];
    if (!selected.length || selected.length > MAX_OFFICE_SEND_RANGES) return null;
    const ranges = selected.map((item) => {
      const { startRow, startColumn, endRow, endColumn } = item.getRange();
      if (
        endRow < startRow ||
        endColumn < startColumn ||
        endRow >= sheet.getMaxRows() ||
        endColumn >= sheet.getMaxColumns()
      )
        throw new Error("Selection is outside its native worksheet.");
      const a1 = item.getA1Notation();
      return {
        startRow,
        startColumn,
        endRow,
        endColumn,
        ...(a1.length > 0 && a1.length <= 96 ? { a1 } : {}),
      };
    });
    return decode({ sheetId: sheet.getSheetId(), sheetName: sheet.getSheetName(), ranges });
  } catch {
    return null;
  }
}
export function selectionFields(native: NativeApplication | null, unitId?: string) {
  const selection = captureSheetSelection(native, unitId);
  return selection === null ? {} : { selection };
}
