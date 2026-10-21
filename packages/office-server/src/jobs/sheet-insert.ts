import { DateSystem, generateRandomId, type IWorkbookData } from "@univerjs/core";
import type { IMutation } from "@univerjs/protocol";
import {
  OfficeConflict,
  OfficeInvalid,
  OfficeLimited,
  safeFailure,
  type ImportInto,
} from "@starter/office-contract";
import { encodeNativeFrame, NativeWireError } from "@starter/office-contract/native-wire";
import type { NativeInputFrame } from "../ports/jobs.ts";
import { loadOfflineRuntime } from "./offline.ts";
import { requireSheetProfile, checkedImportSheet } from "./sheet-profile.ts";
import { requireEmptySheetResources } from "./sheet-resources.ts";
import { prepareSheetStyles } from "./sheet-styles.ts";
import { JOB_NATIVE_LIMITS } from "./frames.ts";
import { preflightSheetLoads } from "./sheet-load-preflight.ts";

function deny(): never {
  throw new OfficeInvalid(safeFailure("FORBIDDEN"));
}
function conflict(): never {
  throw new OfficeConflict(safeFailure("NATIVE_CONFLICT"));
}
function isWorkbook(value: object): value is IWorkbookData {
  return "sheets" in value && "sheetOrder" in value && "styles" in value;
}

/** SDK InsertSheet, not same-workbook CopySheet or a JSON snapshot merge. */
export function sheetInsertions(
  source: IWorkbookData,
  target: IWorkbookData,
  action: ImportInto,
): readonly IMutation[] {
  requireSheetProfile(source);
  if (
    !target.id ||
    target.id === source.id ||
    (source.dateSystem ?? DateSystem.Date1900) !== (target.dateSystem ?? DateSystem.Date1900)
  )
    deny();
  if (
    source.sheetOrder.length !== new Set(source.sheetOrder).size ||
    source.sheetOrder.length !== Object.keys(source.sheets).length
  )
    deny();
  const requested = action.selection.sheets;
  const names = new Set(requested === "all" ? [] : requested);
  const selected = source.sheetOrder.filter(
    (id) => requested === "all" || names.has(source.sheets[id]?.name ?? ""),
  );
  if (
    !selected.length ||
    selected.length > 32 ||
    (requested !== "all" && selected.length !== requested.length)
  )
    deny();
  const targetNames = new Set(
    Object.values(target.sheets).map((sheet) => sheet.name?.toLowerCase()),
  );
  const requestedNames = new Map(
    action.selection.destinationNames.map((item) => [item.sourceName, item.destinationName]),
  );
  const selectedNames = new Set(selected.map((id) => source.sheets[id]?.name));
  if ([...requestedNames.keys()].some((name) => !selectedNames.has(name))) deny();
  const allocated = new Set<string>();
  const sheets = selected.map((id) => {
    const sheet = checkedImportSheet(source, id);
    const destination = requestedNames.get(sheet.name) ?? sheet.name;
    const name = destination.toLowerCase();
    if (targetNames.has(name)) conflict();
    targetNames.add(name);
    // Same public SDK allocator used by InsertSheetCommand. Never relabel a Document/Unit.
    const fresh = generateRandomId();
    if (
      !fresh ||
      Object.hasOwn(target.sheets, fresh) ||
      Object.hasOwn(source.sheets, fresh) ||
      allocated.has(fresh)
    )
      conflict();
    allocated.add(fresh);
    sheet.id = fresh;
    sheet.name = destination;
    return sheet;
  });
  const native = prepareSheetStyles(source, target, sheets);
  const result = native.sheets.map((sheet, offset): IMutation => ({
    id: "sheet.mutation.insert-sheet",
    data: JSON.stringify({
      unitId: target.id,
      index: target.sheetOrder.length + offset,
      sheet,
      ...(offset === 0 ? { styles: native.styles } : {}),
    }),
  }));
  try {
    encodeNativeFrame("job-output", result, { ...JOB_NATIVE_LIMITS, maxBytes: 2 * 1024 * 1024 });
  } catch (error) {
    if (error instanceof NativeWireError)
      throw error.code === "LIMIT_EXCEEDED"
        ? new OfficeLimited(safeFailure("LIMIT_EXCEEDED"))
        : new OfficeInvalid(safeFailure("INVALID_INPUT"));
    throw error;
  }
  return result;
}
function sameIdentity(input: NativeInputFrame, workbook: IWorkbookData): void {
  const original = input.native.snapshot.workbook;
  if (
    !original ||
    workbook.id !== input.binding.unitId ||
    JSON.stringify(workbook.sheetOrder) !== JSON.stringify(original.sheetOrder)
  )
    deny();
  for (const id of original.sheetOrder)
    if (workbook.sheets[id]?.id !== id || workbook.sheets[id]?.name !== original.sheets[id]?.name)
      deny();
}
/** Reject unsupported ORIGINAL resource graphs before SDK loading can omit unknown hooks. */
export async function prepareSheetInsertions(
  source: NativeInputFrame,
  target: NativeInputFrame,
  action: ImportInto,
): Promise<readonly IMutation[]> {
  preflightSheetLoads([source.native, target.native]);
  requireEmptySheetResources(source.native.snapshot.workbook?.resources);
  const from = await loadOfflineRuntime(source);
  try {
    const into = await loadOfflineRuntime(target);
    try {
      const a = await from.exportUnitData(),
        b = await into.exportUnitData();
      if (!isWorkbook(a) || !isWorkbook(b)) deny();
      sameIdentity(source, a);
      sameIdentity(target, b);
      return sheetInsertions(a, b, action);
    } finally {
      await into.close();
    }
  } finally {
    await from.close();
  }
}
