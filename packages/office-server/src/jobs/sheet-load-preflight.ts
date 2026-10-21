import type { ISnapshotWithBlocks } from "@univerjs-pro/collaboration-service";
import type { IChangeset } from "@univerjs/protocol";
import { UniverType } from "@univerjs/protocol";
import {
  createSheetLoadBudget,
  invalid,
  record,
  integer,
  type SheetDimensions,
  type SheetLoadBudget,
} from "./sheet-load-budget.ts";
import { admitCells, admitSheet } from "./sheet-load-geometry.ts";
import { admitSheetHistory } from "./sheet-load-history.ts";
import { requireEmptySheetResources } from "./sheet-resources.ts";

function shadows(data: Record<string, unknown>, keys: readonly string[]): void {
  if (keys.some((key) => Object.hasOwn(data, key))) invalid();
}
function snapshot(input: ISnapshotWithBlocks, budget: SheetLoadBudget) {
  const workbook = input.snapshot.workbook;
  if (input.snapshot.type !== UniverType.UNIVER_SHEET || !workbook) invalid();
  const ids = Object.keys(workbook.sheets);
  if (
    !ids.length ||
    workbook.sheetOrder.length !== ids.length ||
    new Set(workbook.sheetOrder).size !== ids.length ||
    workbook.sheetOrder.some((id) => !Object.hasOwn(workbook.sheets, id))
  )
    invalid();
  const book = budget.json(workbook.originalMeta, true);
  shadows(book, ["id", "unitID", "rev", "name", "sheetOrder", "sheets", "resources", "cellData"]);
  if (
    Object.keys(book).some(
      (key) =>
        !["appVersion", "locale", "dateSystem", "styles", "defaultStyle", "custom"].includes(key),
    )
  )
    invalid();
  if (
    book.custom !== undefined &&
    book.custom !== null &&
    Object.keys(record(book.custom)).length !== 0
  )
    invalid();
  for (const resource of workbook.resources ?? [])
    if (resource.data !== "") budget.json(resource.data, true);
  try {
    requireEmptySheetResources(workbook.resources);
  } catch {
    invalid();
  }
  if (book.styles !== undefined) budget.charge("styles", Object.keys(record(book.styles)).length);
  const dimensions = new Map<string, SheetDimensions>();
  for (const id of ids) {
    const header = workbook.sheets[id];
    if (!header || header.id !== id || !header.name) invalid();
    const data = budget.json(header.originalMeta, true);
    shadows(data, ["id", "name", "rowCount", "columnCount", "cellData"]);
    dimensions.set(id, admitSheet(data, header.rowCount, header.columnCount, budget));
  }
  budget.charge("blocks", input.sheetBlocks.length);
  const blocks = new Map(input.sheetBlocks.map((block) => [block.id, block]));
  if (blocks.size !== input.sheetBlocks.length) invalid();
  const used = new Set<string>();
  for (const [id, group] of Object.entries(workbook.blockMeta)) {
    const size = dimensions.get(id);
    if (!size || (group.sheetID !== undefined && group.sheetID !== id)) invalid();
    for (const blockId of group.blocks) {
      const block = blocks.get(blockId);
      if (!block || used.has(blockId)) invalid();
      used.add(blockId);
      const start = integer(block.startRow, 0, size.rows - 1);
      const end = integer(block.endRow, start, size.rows - 1);
      admitCells(budget.json(block.data), size, budget, { start, end });
    }
  }
  if (used.size !== blocks.size) invalid();
  return dimensions;
}
/** Read-only admission of ORIGINAL headers/JSON, ALL sheets. Never returns a replacement model. */
export function preflightSheetLoads(
  inputs: readonly ISnapshotWithBlocks[],
  history: readonly IChangeset[] = [],
): void {
  const budget = createSheetLoadBudget();
  let target: Map<string, SheetDimensions> | undefined;
  for (const input of inputs) target = snapshot(input, budget);
  const last = inputs.at(-1);
  if (!last || !target) invalid();
  admitSheetHistory(history, last.snapshot.unitID, target, budget);
}
