import {
  officeAttachmentIds,
  officeImportOptions,
  OfficeUnavailable,
  safeFailure,
} from "@highchat/office-contract";
import type { Draft, Receipt, Target, View } from "@highchat/office-contract";
import type { OfficeWorkflow } from "./workflow.ts";
import type { OfficeOutput } from "./dispatch.ts";

export class UnsupportedPreview extends Error {
  readonly code = "UNSUPPORTED_PREVIEW";
  constructor() {
    super("This attachment cannot be opened in Univer. The panel was not changed.");
  }
}
export const confirmedImport = (
  receipt: Receipt,
): receipt is Receipt & { documentId: string; draftId: string } =>
  receipt.kind === "create" &&
  receipt.phase === "confirmed" &&
  receipt.error === null &&
  receipt.documentId !== null &&
  receipt.draftId !== null;

/** Public recovery instructions only; these IDs never grant access or dispatch anything. */
export function attachmentWorkflow(attachmentId: string, receipt: Receipt | null) {
  const ready = receipt !== null && confirmedImport(receipt);
  return {
    state: ready ? "ready" : receipt === null ? "import-required" : "import-unconfirmed",
    nextAction: ready ? "inspect-worktree" : receipt === null ? "import" : "observe-import",
    attachmentId,
    worktreeId: ready ? receipt.draftId : null,
    operationId: receipt?.operationId ?? null,
    phase: receipt?.phase ?? null,
    instructions: ready
      ? "Import is confirmed. Pass this worktreeId explicitly with your inspect command; do not inspect Main or guess a draft."
      : receipt === null
        ? "This saved original is not imported. Call the next import command first, then inspect with the confirmed returned worktreeId."
        : "Import is not confirmed. Observe this exact operation; do not inspect, re-import or retry an uncertain write.",
    ...(!ready
      ? {
          nextCall: {
            tool: "univer_cli",
            arguments: {
              attachmentId,
              command: receipt === null ? ["import"] : ["operation", receipt.operationId],
            },
          },
        }
      : {}),
  };
}

/** Reuses the same import operation as explicit user opens. Never imports an original twice. */
export async function attachmentImport(
  workflow: OfficeWorkflow,
  attachmentId: string,
): Promise<Receipt> {
  const { attachment, receipt } = await workflow.describe();
  const options = officeImportOptions(attachment.mediaType, attachment.name);
  if (options === null) throw new UnsupportedPreview();
  if (receipt !== null) return receipt;
  const { operationId, uploadId } = officeAttachmentIds(attachmentId);
  await workflow.run(
    { command: "stage-file", input: { operationId: uploadId, fileRef: attachmentId } },
    "import-upload",
    uploadId,
  );
  const output = await workflow.run(
    {
      command: "create",
      input: {
        operationId,
        title: attachment.name.trim().slice(0, 120),
        destination: "new-draft",
        source: { kind: "office", uploadId, options },
      },
    },
    "import-create",
    operationId,
  );
  if (output.kind !== "receipt") throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
  return output.value;
}

export async function attachmentDraft(workflow: OfficeWorkflow): Promise<
  | {
      draft: Draft;
      target: Target;
      receipt: Receipt;
    }
  | { receipt: Receipt; draft: null; target: null }
> {
  const { attachment, receipt } = await workflow.describe();
  if (!officeImportOptions(attachment.mediaType, attachment.name)) throw new UnsupportedPreview();
  if (receipt === null) throw new OfficeUnavailable(safeFailure("CONTENT_REQUIRED"));
  if (!confirmedImport(receipt)) return { receipt, draft: null, target: null };
  const output = await workflow.run({ command: "draft", draftId: receipt.draftId }, "draft");
  if (output.kind !== "draft" || output.value.documentId !== receipt.documentId)
    throw new OfficeUnavailable(safeFailure("CONTENT_REQUIRED"));
  const draft = output.value;
  if (draft.status === "discarded" || draft.status === "merged" || draft.status === "merging")
    throw new OfficeUnavailable(safeFailure("NOT_EDITABLE"));
  return {
    draft,
    receipt,
    target: {
      documentId: draft.documentId,
      scope: { kind: "draft", draftId: draft.id, generation: draft.generation },
    },
  };
}

export async function attachmentView(
  workflow: OfficeWorkflow,
  draft: Draft,
  target: Target,
): Promise<View> {
  const output: OfficeOutput = await workflow.run({ command: "open", input: target }, "view");
  if (output.kind !== "view") throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
  workflow.basis = {
    documentId: draft.documentId,
    draftId: draft.id,
    generation: draft.generation,
    expectedRevision: output.value.revision,
  };
  return output.value;
}
