import { freezeOfficeSendTarget, type Target, type View } from "@starter/office-contract";
import type { OfficeRuntime, OfficeSave } from "@starter/office-react";
import { officeFail } from "@/lib/browser-diagnostics";
import { assertOfficeViewTarget, type OpenOffice } from "@/lib/office-runtime";

/**
 * The server binds a Send target to one exact stored View. The displayed View is older than
 * the acknowledged save after native edits, so capture the same target's current View through
 * the existing open API instead of guessing a revision or weakening the stored check. Only
 * consulted when the displayed View is behind; a head that raced past the save refuses.
 */
export async function captureOfficeCheckpoint(
  runtime: OfficeRuntime,
  target: Target,
  opened: OpenOffice,
  acknowledged: OfficeSave,
  signal: AbortSignal,
): Promise<View> {
  if (acknowledged.viewId !== opened.view.id)
    throw officeFail("office.anchor", "snapshot", "anchor-changed", opened.view.id);
  if (acknowledged.revision === opened.view.revision) return opened.view;
  signal.throwIfAborted();
  const fresh = await runtime.run(runtime.client.office.open({ payload: target }), { signal });
  signal.throwIfAborted();
  assertOfficeViewTarget(fresh, target);
  if (fresh.revision !== acknowledged.revision)
    throw officeFail("office.anchor", "snapshot", "checkpoint-changed", fresh.id);
  return fresh;
}

/** Freeze the exact reviewed View; a real save stays valid if a broadcast advances the head. */
export function officeSendAnchor(
  opened: OpenOffice,
  acknowledged: OfficeSave | null,
  checkpoint: View | null,
  target: Target,
) {
  if (opened.view.nativeTarget.kind === "pinned-snapshot") return null;
  assertOfficeViewTarget(opened.view, target);
  if (
    acknowledged === null ||
    checkpoint === null ||
    acknowledged.viewId !== opened.view.id ||
    !Number.isSafeInteger(acknowledged.revision) ||
    acknowledged.revision < opened.view.revision ||
    checkpoint.revision !== acknowledged.revision
  )
    throw officeFail("office.anchor", "snapshot", "anchor-changed", opened.view.id);
  const common = {
    viewId: checkpoint.id,
    documentId: checkpoint.documentId,
    documentKind: checkpoint.kind,
    expectedRevision: acknowledged.revision,
  };
  return freezeOfficeSendTarget(
    target.scope.kind === "main"
      ? { kind: "main", ...common }
      : {
          kind: "draft",
          ...common,
          draftId: target.scope.draftId,
          generation: target.scope.generation,
        },
  );
}

/** Checkpoint capture plus the frozen anchor, in the one order Send requires. */
export async function checkpointOfficeSendTarget(
  runtime: OfficeRuntime,
  target: Target,
  opened: OpenOffice,
  acknowledged: OfficeSave | null,
  signal: AbortSignal,
) {
  const checkpoint =
    acknowledged === null
      ? null
      : await captureOfficeCheckpoint(runtime, target, opened, acknowledged, signal);
  return officeSendAnchor(opened, acknowledged, checkpoint, target);
}
