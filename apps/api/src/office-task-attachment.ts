import { Effect } from "effect";
import { officeAttachmentIds, officeImportOptions } from "@starter/office-contract";
import type { DraftTarget } from "@starter/office-contract";
import type { OfficeMetadata, OperationRecord } from "@starter/office-server/ports";
import type { OfficeTaskProof } from "./office-task-proof.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";

export type OfficeTaskAttachment = {
  readonly operation: OperationRecord;
  readonly target: DraftTarget | null;
};

/** Root-only lookup after private callback/session proof. Never a model-supplied mapping. */
export async function readOfficeTaskAttachment(
  metadata: OfficeMetadata,
  proof: OfficeTaskProof,
  observeOnly = false,
): Promise<OfficeTaskAttachment | null> {
  const { intent, originals, session } = proof.association;
  if (!intent.attachmentId) return null;
  const file = originals.find((item) => item.fileId === intent.attachmentId);
  if (!file) throw officeDenied();
  const options = officeImportOptions(file.mediaType, file.name);
  if (options === null) return null;
  const owner = { stage: session.stage, ownerId: session.ownerId };
  const ids = officeAttachmentIds(file.fileId);
  const operation = await Effect.runPromise(metadata.operation(owner, ids.operationId));
  if (operation === null) return null;
  const input = operation.intent;
  if (
    !officeSame(operation.owner, owner) ||
    !officeSame(operation.actor.owner, owner) ||
    operation.actor.principalId !== session.ownerId ||
    operation.receipt.operationId !== ids.operationId ||
    input.kind !== "create" ||
    input.input.destination !== "new-draft" ||
    input.input.source.kind !== "office" ||
    input.input.source.uploadId !== ids.uploadId ||
    !officeSame(input.input.source.options, options)
  )
    throw officeDenied();
  const source = operation.artifacts.source;
  if (
    source !== null &&
    (source.id !== ids.uploadId ||
      source.kind !== "upload" ||
      source.digest !== file.digest ||
      source.bytes !== file.byteSize)
  )
    throw officeDenied();
  if (operation.receipt.phase !== "confirmed") return { operation, target: null };
  if (
    source === null ||
    operation.receipt.draftId === null ||
    operation.receipt.acceptedRevision === null
  )
    throw officeDenied();
  const draft = await Effect.runPromise(metadata.draft(owner, operation.receipt.draftId));
  const document = await Effect.runPromise(metadata.document(owner, operation.documentId));
  if (
    draft === null ||
    document === null ||
    !officeSame(draft.owner, owner) ||
    !officeSame(document.owner, owner) ||
    draft.originOperationId !== ids.operationId ||
    document.originOperationId !== ids.operationId ||
    draft.documentId !== operation.documentId ||
    document.unitId !== operation.unitId ||
    draft.worktreeId !== operation.worktreeId ||
    operation.receipt.documentId !== operation.documentId
  )
    throw officeDenied();
  const basis = observeOnly ? undefined : intent.basis;
  if (
    basis &&
    (basis.documentId !== draft.documentId ||
      basis.draftId !== draft.id ||
      basis.generation !== draft.generation)
  )
    throw officeDenied();
  return {
    operation,
    target: {
      documentId: draft.documentId,
      draftId: draft.id,
      generation: draft.generation,
      expectedRevision: basis?.expectedRevision ?? operation.receipt.acceptedRevision,
    },
  };
}
