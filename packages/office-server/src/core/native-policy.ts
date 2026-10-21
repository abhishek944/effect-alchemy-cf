import { UnitAction, UnitObject, UniverType } from "@univerjs/protocol";
import type { RequiredUnitPermission } from "@univerjs-pro/collaboration-service";
import type { OperationRecord } from "../ports/index.ts";
import type { NativeStep } from "./native-lease.ts";
import { officeFailure } from "./failure.ts";

const contentActions = new Set<UnitAction>([
  UnitAction.View,
  UnitAction.Edit,
  UnitAction.Copy,
  UnitAction.InsertHyperlink,
  UnitAction.Sort,
  UnitAction.Filter,
  UnitAction.PivotTable,
  UnitAction.MoveWorksheet,
  UnitAction.DeleteWorksheet,
  UnitAction.HideWorksheet,
  UnitAction.RenameWorksheet,
  UnitAction.CreateWorksheet,
  UnitAction.SetWorksheetStyle,
  UnitAction.EditWorksheetCell,
  UnitAction.RwHgtClWdt,
  UnitAction.MoveSheet,
  UnitAction.DeleteSheet,
  UnitAction.HideSheet,
  UnitAction.CopySheet,
  UnitAction.RenameSheet,
  UnitAction.CreateSheet,
  UnitAction.SelectProtectedCells,
  UnitAction.SelectUnProtectedCells,
  UnitAction.SetCellStyle,
  UnitAction.SetCellValue,
  UnitAction.SetRowStyle,
  UnitAction.SetColumnStyle,
  UnitAction.InsertRow,
  UnitAction.InsertColumn,
  UnitAction.DeleteRow,
  UnitAction.DeleteColumn,
  UnitAction.EditExtraObject,
]);
export function checkNativePermissions(
  permissions: readonly RequiredUnitPermission[],
  unitId: string,
  type: UniverType,
): void {
  const objects =
    type === UniverType.UNIVER_SHEET
      ? [UnitObject.Workbook, UnitObject.Worksheet, UnitObject.SelectRange]
      : type === UniverType.UNIVER_DOC
        ? [
            UnitObject.Document,
            UnitObject.DocumentSection,
            UnitObject.DocumentParagraph,
            UnitObject.DocumentEntity,
          ]
        : type === UniverType.UNIVER_SLIDE
          ? [
              UnitObject.Slide,
              UnitObject.SlidePage,
              UnitObject.SlideElement,
              UnitObject.SlideMaster,
            ]
          : [];
  if (
    permissions.some(
      (permission) =>
        permission.unitID !== unitId ||
        !objects.includes(permission.objectType) ||
        !contentActions.has(permission.action),
    )
  )
    throw officeFailure("FORBIDDEN");
}
/** Every actual native leaf must belong to the immutable domain intent, including direct callers. */
export function checkNativeIntent(operation: OperationRecord, step: NativeStep): void {
  const transition = step.kind === "worktree-transition" ? step.action : null;
  let allowed = false;
  switch (operation.intent.kind) {
    case "execute":
    case "import-into":
      allowed =
        step.kind === "draft-commit" &&
        step.input.worktreeID === operation.worktreeId &&
        step.input.changeset.unitID === operation.unitId &&
        step.input.changeset.userID === operation.owner.ownerId &&
        step.input.changeset.baseRev === operation.intent.input.target.expectedRevision &&
        step.input.changeset.revision === operation.intent.input.target.expectedRevision + 1;
      break;
    case "create":
      allowed =
        operation.intent.input.destination === "main"
          ? step.kind === "core-create"
          : step.kind === "worktree-create" || step.kind === "draft-create";
      break;
    case "create-draft":
      allowed = step.kind === "worktree-create" || step.kind === "worktree-add";
      break;
    case "ready":
      allowed = transition === "markReady" || step.kind === "draft-artifact";
      break;
    case "reopen":
      allowed = transition === "reopenWorktree";
      break;
    case "discard":
      allowed = transition === "discardWorktree";
      break;
    case "merge":
      allowed =
        [
          "core-create",
          "core-commit",
          "core-snapshot",
          "draft-artifact",
          "worktree-result",
        ].includes(step.kind) ||
        transition === "startOrResumeMerge" ||
        transition === "finishMerge";
      break;
    case "approve":
    case "render":
    case "export":
      break;
  }
  if (
    !allowed ||
    (operation.actor.capability === "draft-task" &&
      (step.kind.startsWith("core-") ||
        step.kind === "worktree-result" ||
        transition === "startOrResumeMerge" ||
        transition === "finishMerge"))
  )
    throw officeFailure("FORBIDDEN", operation.receipt.operationId);
}
