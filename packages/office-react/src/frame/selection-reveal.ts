import { DOC_RANGE_TYPE, IUniverInstanceService, type Workbook } from "@univerjs/core";
import { DocSkeletonManagerService } from "@univerjs/docs";
import { DocBackScrollRenderController, DocSelectionRenderService } from "@univerjs/docs-ui";
import { IRenderManagerService } from "@univerjs/engine-render";
import { SetSelectionsOperation, SelectionMoveType, getPrimaryForRange } from "@univerjs/sheets";
import type { NativeApplication } from "./native.ts";
import { captureSheetSelection } from "./selection.ts";
import { captureFailure, readDocScope, type SelectionScope } from "./selection-scope.ts";

const coordinates = (scope: Extract<SelectionScope, { kind: "sheet-range" }>) =>
  JSON.stringify([
    scope.sheetId,
    scope.ranges.map(({ startRow, startColumn, endRow, endColumn }) => [
      startRow,
      startColumn,
      endRow,
      endColumn,
    ]),
  ]);
export async function revealSelection(
  native: NativeApplication,
  container: HTMLElement,
  unitId: string,
  scope: SelectionScope,
  signal: AbortSignal,
  check: () => void,
) {
  const visible = () => {
    const frame = window.frameElement;
    const options = { checkVisibilityCSS: true, checkOpacity: true };
    return (
      !signal.aborted &&
      document.visibilityState === "visible" &&
      container.checkVisibility(options) &&
      (frame === null || frame.checkVisibility(options)) &&
      container.getBoundingClientRect().width > 1 &&
      container.getBoundingClientRect().height > 1
    );
  };
  if (!visible()) throw captureFailure("capture-unavailable");
  check();
  if (scope.kind === "sheet-range") {
    const workbook = native.univerAPI.getWorkbook(unitId);
    const sheet = workbook?.getSheetBySheetId(scope.sheetId);
    const model = native.injector.get(IUniverInstanceService).getUnit<Workbook>(unitId);
    const worksheet = model?.getSheetBySheetId(scope.sheetId);
    if (!workbook || !sheet || !worksheet || sheet.isSheetHidden())
      throw captureFailure("capture-unavailable");
    workbook.setActiveSheet(sheet);
    check();
    const selected = await native.univerAPI.executeCommand(SetSelectionsOperation.id, {
      unitId,
      subUnitId: scope.sheetId,
      type: SelectionMoveType.ONLY_SET,
      selections: scope.ranges.map(({ startRow, startColumn, endRow, endColumn }) => {
        const range = { startRow, startColumn, endRow, endColumn };
        return { range, primary: getPrimaryForRange(range, worksheet), style: null };
      }),
    });
    check();
    if (!visible() || !selected) throw captureFailure("capture-unavailable");
    const first = scope.ranges[0];
    if (first === undefined) throw captureFailure("capture-unavailable");
    sheet.scrollToCell(first.startRow, first.startColumn);
    const actual = captureSheetSelection(native, unitId);
    if (!actual || coordinates({ kind: "sheet-range", ...actual }) !== coordinates(scope))
      throw captureFailure("capture-unavailable");
    return;
  }
  const render = native.injector.get(IRenderManagerService).getRenderUnitById(unitId);
  if (!render || render.isDisposed()) throw captureFailure("capture-unavailable");
  const scroll = render.with(DocBackScrollRenderController);
  if (!scroll.isViewportReady()) throw captureFailure("capture-unavailable");
  const range = {
    startOffset: scope.startOffset,
    endOffset: scope.endOffset,
    segmentId: scope.segmentId,
    segmentPage: scope.segmentPage,
    rangeType: DOC_RANGE_TYPE.TEXT,
    collapsed: false,
  };
  // The public scroller can finish asynchronously. A late callback must never select/focus.
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error === undefined) resolve();
      else reject(error);
    };
    const abort = () => finish(captureFailure("capture-unavailable"));
    const timer = setTimeout(abort, 3000);
    signal.addEventListener("abort", abort, { once: true });
    try {
      scroll.scrollToRange(range, () => finish());
    } catch (cause) {
      finish(cause);
    }
  });
  check();
  if (!visible() || !scroll.isViewportReady()) throw captureFailure("capture-unavailable");
  const skeleton = render.with(DocSkeletonManagerService).getSkeleton();
  if (
    !skeleton?.findNodePositionByCharIndex(
      scope.startOffset,
      true,
      scope.segmentId,
      scope.segmentPage,
    ) ||
    !skeleton.findNodePositionByCharIndex(scope.endOffset, true, scope.segmentId, scope.segmentPage)
  )
    throw captureFailure("capture-unavailable");
  const selection = render.with(DocSelectionRenderService);
  selection.setSegment(scope.segmentId);
  selection.setSegmentPage(scope.segmentPage);
  if (!selection.replaceDocRanges([range], false)) throw captureFailure("capture-unavailable");
  const actual = readDocScope(native, unitId);
  if (
    !actual ||
    actual.kind !== "doc-text" ||
    actual.segmentId !== scope.segmentId ||
    actual.segmentPage !== scope.segmentPage ||
    actual.startOffset !== scope.startOffset ||
    actual.endOffset !== scope.endOffset ||
    actual.text !== scope.text
  )
    throw captureFailure("capture-unavailable");
  check();
  selection.focus();
}
