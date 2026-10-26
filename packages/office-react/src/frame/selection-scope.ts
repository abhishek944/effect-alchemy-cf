import { DOC_RANGE_TYPE } from "@univerjs/core";
import { DocSelectionManagerService } from "@univerjs/docs";
import type { OfficeNativeReferenceContext } from "@starter/office-contract";
import type { NativeApplication } from "./native.ts";
import { captureSheetSelection } from "./selection.ts";
import { nativeFailure } from "./lifecycle.ts";

export type SelectionScope = Exclude<OfficeNativeReferenceContext, { kind: "whole" }>;
export const captureFailure = (
  reason: "capture-changed" | "capture-unavailable" | "capture-unsupported",
) =>
  nativeFailure(
    "input",
    reason,
    reason === "capture-changed"
      ? "Native content changed. Select the context again."
      : reason === "capture-unsupported"
        ? "This native selection cannot be captured exactly."
        : "The captured native scope is unavailable. Show its source and select again.",
  );
const splitSurrogate = (text: string, offset: number) =>
  offset > 0 &&
  offset < text.length &&
  text.charCodeAt(offset - 1) >= 0xd800 &&
  text.charCodeAt(offset - 1) <= 0xdbff &&
  text.charCodeAt(offset) >= 0xdc00 &&
  text.charCodeAt(offset) <= 0xdfff;

export function readDocScope(native: NativeApplication, unitId: string): SelectionScope | null {
  const document = native.univerAPI.getDocument(unitId);
  if (!document || native.univerAPI.getActiveDocument()?.getId() !== unitId) return null;
  const info = native.injector
    .get(DocSelectionManagerService)
    .getSelectionInfo({ unitId, subUnitId: unitId });
  if (!info || info.rectRanges.length !== 0 || info.textRanges.length !== 1) return null;
  const range = info.textRanges[0];
  if (range === undefined) return null;
  if (range.rangeType !== DOC_RANGE_TYPE.TEXT || range.startOffset === range.endOffset) return null;
  const segmentId = info.segmentId;
  const segmentPage = info.segmentPage;
  if ((range.segmentId ?? "") !== segmentId || (range.segmentPage ?? -1) !== segmentPage)
    return null;
  const scope = {
    kind: "doc-text" as const,
    segmentId,
    segmentPage,
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    text: document.getBody(segmentId).dataStream.slice(range.startOffset, range.endOffset),
  };
  validateScope(native, unitId, scope);
  return scope;
}
export function readSelectionScope(
  native: NativeApplication,
  unitId: string,
  kind: string,
): SelectionScope | null {
  if (kind === "doc") return readDocScope(native, unitId);
  if (kind !== "sheet") return null;
  const sheet = captureSheetSelection(native, unitId);
  return sheet === null ? null : { kind: "sheet-range", ...sheet };
}
/** Validate the frozen scope itself, not today's selection or today's text at old offsets. */
export function validateScope(native: NativeApplication, unitId: string, scope: SelectionScope) {
  if (scope.kind === "sheet-range") {
    const sheet = native.univerAPI.getWorkbook(unitId)?.getSheetBySheetId(scope.sheetId);
    if (!sheet || sheet.isSheetHidden()) throw captureFailure("capture-unavailable");
    if (
      scope.ranges.length < 1 ||
      scope.ranges.length > 8 ||
      scope.ranges.some(
        (r) =>
          ![r.startRow, r.endRow, r.startColumn, r.endColumn].every(
            (n) => Number.isSafeInteger(n) && n >= 0,
          ) ||
          r.startRow > r.endRow ||
          r.startColumn > r.endColumn ||
          r.endRow >= sheet.getMaxRows() ||
          r.endColumn >= sheet.getMaxColumns(),
      )
    )
      throw captureFailure("capture-unsupported");
    return;
  }
  const document = native.univerAPI.getDocument(unitId);
  const model = document?.getDocumentDataModel().getSelfOrHeaderFooterModel(scope.segmentId);
  if (
    !model ||
    scope.segmentId.length > 96 ||
    !Number.isSafeInteger(scope.segmentPage) ||
    (scope.segmentId === "" ? scope.segmentPage !== -1 : scope.segmentPage < 0)
  )
    throw captureFailure("capture-unavailable");
  const body = model.getBody();
  const stream = body?.dataStream;
  const { startOffset: start, endOffset: end, text } = scope;
  if (
    stream === undefined ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > stream.length - 2 ||
    text.length > 4096 ||
    splitSurrogate(stream, start) ||
    splitSurrogate(stream, end) ||
    text.split("").some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    }) ||
    body?.customBlocks?.some((block) => block.startIndex >= start && block.startIndex < end)
  )
    throw captureFailure("capture-unsupported");
  if (stream.slice(start, end) !== text) throw captureFailure("capture-changed");
}
