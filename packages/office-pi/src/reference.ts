import {
  OfficeInvalid,
  OfficeUnavailable,
  officeImportOptions,
  safeFailure,
} from "@highchat/office-contract";
import type { Target, View } from "@highchat/office-contract";
import type { OfficeToolSource } from "./parameters.ts";
import type { OfficeWorkflow } from "./workflow.ts";
import type { Receipt } from "@highchat/office-contract";
import { attachmentWorkflow, confirmedImport, UnsupportedPreview } from "./attachment.ts";

/** Expected read precondition with source-proven recovery; never performs an import. */
export class OfficeImportRequired extends Error {
  readonly code = "CONTENT_REQUIRED";
  readonly workflow: ReturnType<typeof attachmentWorkflow>;
  constructor(attachmentId: string, receipt: Receipt | null) {
    super("Import must be confirmed and its worktree selected before inspection or opening.");
    this.workflow = attachmentWorkflow(attachmentId, receipt);
  }
}

/** An explicit source selector, not a request to create or silently choose a draft. */
export async function sourceTarget(workflow: OfficeWorkflow, request: OfficeToolSource) {
  const source = await workflow.describeSource();
  const attachment = workflow.attachment;
  if (attachment !== undefined && !workflow.hasNativeReference) {
    if (officeImportOptions(attachment.mediaType, attachment.name) === null)
      throw new UnsupportedPreview();
    const receipt = workflow.importReceipt;
    if (receipt === undefined) throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
    if (
      receipt === null ||
      !confirmedImport(receipt) ||
      (request.worktreeId === undefined && !source?.mainAvailable)
    )
      throw new OfficeImportRequired(request.attachmentId, receipt);
  }
  if (source === null) throw new OfficeUnavailable(safeFailure("CONTENT_REQUIRED"));
  let target: Target;
  if (request.worktreeId === undefined) {
    if (!source.mainAvailable) throw new OfficeUnavailable(safeFailure("CONTENT_REQUIRED"));
    target = { documentId: source.documentId, scope: { kind: "main" } };
  } else {
    const draft = source.worktree;
    if (draft === null || draft.id !== request.worktreeId)
      throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
    target = {
      documentId: source.documentId,
      scope: { kind: "draft", draftId: draft.id, generation: draft.generation },
    };
  }
  return { source, target };
}

/** Fresh open followed by private exact-basis binding for the rest of this command. */
export async function sourceView(workflow: OfficeWorkflow, target: Target): Promise<View> {
  const opened = await workflow.run({ command: "open", input: target }, "view");
  if (opened.kind !== "view") throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
  if (target.scope.kind === "main")
    workflow.mainView = {
      kind: "main",
      documentId: target.documentId,
      documentKind: opened.value.kind,
      viewId: opened.value.id,
      expectedRevision: opened.value.revision,
    };
  else
    workflow.basis = {
      documentId: target.documentId,
      draftId: target.scope.draftId,
      generation: target.scope.generation,
      expectedRevision: opened.value.revision,
    };
  return opened.value;
}
