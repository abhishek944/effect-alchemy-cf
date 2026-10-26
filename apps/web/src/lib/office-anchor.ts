import {
  MAX_OFFICE_SEND_ATTACHMENTS,
  Id,
  freezeOfficeSendTarget,
  type OfficeSendContext,
  type Target,
  type View,
} from "@starter/office-contract";
import type { OfficeEditorHandle, OfficeRuntime, OfficeSave } from "@starter/office-react";
import { Schema } from "effect";
import { officeFail } from "@/lib/browser-diagnostics";
import { assertOfficeViewTarget, type OpenOffice } from "@/lib/office-runtime";

const isId = Schema.is(Id);
/**
 * Descriptive Send context: the files this tab actually opened plus the cell selection the editor
 * showed. It is not a task, View or read/write grant, and a malformed identity is dropped rather
 * than allowed to block a real Send.
 */
export const officeSendContext = (
  attachmentIds: readonly string[],
  sheet: OfficeSendContext["sheet"],
): OfficeSendContext | undefined => {
  const ids = [...new Set(attachmentIds)].filter(isId).slice(0, MAX_OFFICE_SEND_ATTACHMENTS);
  if (ids.length === 0 && sheet === undefined) return undefined;
  return {
    ...(ids.length === 0 ? {} : { attachmentIds: ids }),
    ...(sheet === undefined ? {} : { sheet }),
  };
};

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
  context: OfficeSendContext | undefined,
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
  const extra = context === undefined ? {} : { context };
  return freezeOfficeSendTarget(
    target.scope.kind === "main"
      ? { kind: "main", ...common, ...extra }
      : {
          kind: "draft",
          ...common,
          draftId: target.scope.draftId,
          generation: target.scope.generation,
          ...extra,
        },
  );
}

/** Send checkpoints pending edits without ending the editor session or its transport. */
export async function prepareOfficeSendTarget(
  runtime: OfficeRuntime,
  selection: { readonly target: Target; readonly attachments: readonly string[] },
  opened: OpenOffice,
  handle: OfficeEditorHandle,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const acknowledged = await handle.hold();
  try {
    const checkpoint = await captureOfficeCheckpoint(
      runtime,
      selection.target,
      opened,
      acknowledged,
      signal,
    );
    // The hold captured the real selection before native input was sealed; context stays descriptive.
    return officeSendAnchor(
      opened,
      acknowledged,
      checkpoint,
      selection.target,
      officeSendContext(selection.attachments, acknowledged.selection),
    );
  } finally {
    // Release only our temporary hold, never revive an explicitly drained editor.
    if (opened.editor?.state === "active") await handle.resume();
  }
}
