import { UniverType, type IChangeset } from "@univerjs/protocol";
import {
  integer,
  invalid,
  record,
  type SheetDimensions,
  type SheetLoadBudget,
} from "./sheet-load-budget.ts";
import { admitCells, admitSheet } from "./sheet-load-geometry.ts";

/** Admission bounds only. The SDK still performs all actual history/data/OT replay. */
export function admitSheetHistory(
  history: readonly IChangeset[],
  unitId: string,
  dimensions: Map<string, SheetDimensions>,
  budget: SheetLoadBudget,
): void {
  for (const change of history) {
    if (change.unitID !== unitId || change.type !== UniverType.UNIVER_SHEET) invalid();
    budget.charge("mutations", change.mutations.length);
    for (const mutation of change.mutations) {
      const p = budget.json(mutation.data);
      if (p.unitId !== unitId) invalid();
      if (mutation.id === "sheet.mutation.insert-sheet") {
        if (
          Object.keys(p).some(
            (key) =>
              !["unitId", "index", "sheet", "styles", "trigger", "__splitChunk__"].includes(key),
          )
        )
          invalid();
        const sheet = record(p.sheet),
          id = sheet.id;
        if (
          typeof id !== "string" ||
          !id ||
          dimensions.has(id) ||
          typeof sheet.name !== "string" ||
          !sheet.name
        )
          invalid();
        integer(p.index, 0, dimensions.size);
        if (p.styles !== undefined) budget.charge("styles", Object.keys(record(p.styles)).length);
        dimensions.set(id, admitSheet(sheet, sheet.rowCount, sheet.columnCount, budget));
      } else if (mutation.id === "sheet.mutation.set-range-values") {
        if (
          Object.keys(p).some(
            (key) =>
              ![
                "unitId",
                "subUnitId",
                "cellValue",
                "isOverrideStyle",
                "styleRefMap",
                "trigger",
                "__splitChunk__",
              ].includes(key),
          )
        )
          invalid();
        if (typeof p.subUnitId !== "string") invalid();
        const size = dimensions.get(p.subUnitId);
        if (!size) invalid();
        if (p.styleRefMap !== undefined)
          budget.charge("styles", Object.keys(record(p.styleRefMap)).length);
        if (p.cellValue !== null)
          admitCells(p.cellValue, size, budget, undefined, { historyStylePatches: true });
      } else if (mutation.id === "sheet.mutation.set-worksheet-name") {
        if (
          Object.keys(p).some(
            (key) => !["unitId", "subUnitId", "name", "oldName", "trigger"].includes(key),
          )
        )
          invalid();
        if (
          typeof p.subUnitId !== "string" ||
          !dimensions.has(p.subUnitId) ||
          typeof p.name !== "string" ||
          !p.name
        )
          invalid();
      } else if (mutation.id === "sheet.mutation.set-worksheet-order") {
        if (
          Object.keys(p).some(
            (key) => !["unitId", "subUnitId", "fromOrder", "toOrder", "trigger"].includes(key),
          )
        )
          invalid();
        if (typeof p.subUnitId !== "string" || !dimensions.has(p.subUnitId)) invalid();
        integer(p.fromOrder, 0, dimensions.size - 1);
        integer(p.toOrder, 0, dimensions.size - 1);
      } else invalid(); // Unknown coordinate-changing history is not replayed optimistically.
    }
  }
}
