import { Schema } from "effect";
import type { Message } from "@earendil-works/pi-ai";
import type { OfficeSheetSelection } from "@starter/office-contract";
import type { AcceptedInputRecord } from "./chat-accepted-input-schema.ts";

/** Display-only strings; no native selectors or read/write authority cross this boundary. */
export const InputSelection = Schema.Struct({
  name: Schema.String,
  scope: Schema.String,
  quote: Schema.NullOr(Schema.String),
});
export type InputSelection = typeof InputSelection.Type;
export const InputSelections = Schema.Array(InputSelection).check(Schema.isMaxLength(8));

const column = (index: number): string => {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
};
const sheetScope = (sheet: OfficeSheetSelection, includeName = true): string => {
  const ranges = sheet.ranges.map(
    (range) =>
      range.a1 ??
      `${column(range.startColumn)}${range.startRow + 1}:${column(range.endColumn)}${range.endRow + 1}`,
  );
  return `${includeName && sheet.sheetName ? `${sheet.sheetName}!` : ""}${ranges.join(", ")}`;
};

/** Accepted entry association is supplied by the immutable store, never today's editor/tray. */
export function publicInputSelections(
  message: Message,
  accepted: AcceptedInputRecord | null,
): readonly InputSelection[] {
  if (accepted === null || message.role !== "user" || typeof message.content !== "string")
    return [];
  const caption = message.content;
  const inputs = accepted.referenceInputs ?? [];
  const selections: InputSelection[] = [];
  for (const input of inputs) {
    if (input.kind === "original") {
      if (input.text === undefined) continue;
      const original = accepted.originals.find((file) => file.fileId === input.fileId);
      if (original) selections.push({ name: original.name, scope: "Selected text", quote: null });
      continue; // Offsets alone do not preserve the exact quotation; never reread live content.
    }
    if (input.context.kind === "whole") continue;
    const context = input.context;
    const quote = context.kind === "doc-text" ? context.text : null;
    const scope = context.kind === "sheet-range" ? sheetScope(context) : "Selected text";
    const suffix =
      context.kind === "doc-text"
        ? ` · “${context.text.replace(/\r/g, "\n")}”`
        : ` · ${context.sheetName ?? context.sheetId}!${sheetScope(context, false)}`;
    if (input.end > caption.length) throw new Error("Stored selection does not match caption");
    const label = caption.slice(input.start, input.end);
    // Remove only the exact generated suffix of a proven occurrence, not arbitrary prose.
    const name = label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
    selections.push({ name: name || "Selected source", scope, quote });
  }
  // Older accepted targets can preserve selected cells, but not a historical filename.
  if (inputs.length === 0 && accepted.officeTarget?.context?.sheet)
    selections.push({
      name: "Selected spreadsheet",
      scope: sheetScope(accepted.officeTarget.context.sheet),
      quote: null,
    });
  return selections;
}
