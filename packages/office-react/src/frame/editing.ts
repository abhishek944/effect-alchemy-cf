import { DocStateChangeManagerService } from "@univerjs/docs";
import { IEditorService } from "@univerjs/docs-ui";
import { IEditorUIService, ISlideDrawingStateService } from "@univerjs-pro/slides-ui";
import type { FrameInit } from "./messages.ts";
import type { NativeApplication } from "./native.ts";

/** Finish only already-admitted native editing; never cancel/replace pending text to simulate a save. */
export async function finishNativeInput(native: NativeApplication, input: FrameInit) {
  const { view } = input;
  const unitId = view.nativeTarget.unitId;
  if (view.kind === "sheet") {
    const workbook = native.univerAPI.getWorkbook(unitId);
    if (!workbook) throw new Error("Native workbook unavailable.");
    if (workbook.isCellEditing() && !(await workbook.endEditingAsync(true)))
      throw new Error("Native cell input is still pending.");
    return;
  }
  const editors = native.injector.get(IEditorService);
  const focusedId = editors.getFocusEditor()?.getEditorId();
  if (view.kind === "slide") {
    const floating = native.injector.get(IEditorUIService);
    if (floating.getSession() !== null) floating.complete();
    if (floating.getSession() !== null)
      throw new Error("Finish the native slide text editor first.");
  }
  editors.blur();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const changes = native.injector.get(DocStateChangeManagerService);
  if (focusedId !== undefined) changes.flushPendingChanges(focusedId);
  changes.flushPendingChanges(unitId);
  if (
    view.kind === "slide" &&
    native.injector.get(ISlideDrawingStateService).getSnapshot().activeEditingId !== null
  )
    throw new Error("Finish the active native slide text edit before leaving.");
  if (changes.getStateCache(unitId).collaboration.length !== 0)
    throw new Error("Native document input remains pending.");
}
