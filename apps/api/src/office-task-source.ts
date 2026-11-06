import { Effect } from "effect";
import type { DraftTarget, OfficeSourceDescriptor, Target } from "@highchat/office-contract";
import type { OfficeMetadata } from "@highchat/office-server/ports";
import type { OfficeTaskProof } from "./office-task-proof.ts";
import type { OfficeTaskAttachment } from "./office-task-attachment.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";

/** Source identity is proved from a retained original import or current accepted native source. */
export async function readOfficeTaskSource(
  metadata: OfficeMetadata,
  proof: OfficeTaskProof,
  attachment: OfficeTaskAttachment | null,
): Promise<OfficeSourceDescriptor | null> {
  const { session, reference, intent } = proof.association;
  const documentId =
    attachment?.operation.documentId ??
    (reference?.kind === "native" ? reference.target.documentId : undefined);
  if (documentId === undefined) return null;
  const owner = { stage: session.stage, ownerId: session.ownerId };
  const document = await Effect.runPromise(metadata.document(owner, documentId));
  if (
    document === null ||
    !officeSame(document.owner, owner) ||
    document.document.id !== documentId
  )
    throw officeDenied();
  const draft =
    intent.worktreeId === undefined
      ? null
      : await Effect.runPromise(metadata.draft(owner, intent.worktreeId));
  if (
    intent.worktreeId !== undefined &&
    (draft === null ||
      !officeSame(draft.owner, owner) ||
      draft.documentId !== documentId ||
      draft.id !== intent.worktreeId)
  )
    throw officeDenied();
  return {
    documentId,
    mainAvailable: document.location === "main",
    importWorktreeId: attachment?.operation.receipt.draftId ?? null,
    worktree:
      draft === null
        ? null
        : {
            id: draft.id,
            documentId: draft.documentId,
            generation: draft.generation,
          },
  };
}

export function officeSourceTarget(source: OfficeSourceDescriptor, proof: OfficeTaskProof): Target {
  const worktreeId = proof.association.intent.worktreeId;
  if (worktreeId === undefined) {
    if (!source.mainAvailable) throw officeDenied();
    return { documentId: source.documentId, scope: { kind: "main" } };
  }
  const draft = source.worktree;
  if (draft === null || draft.id !== worktreeId) throw officeDenied();
  return {
    documentId: source.documentId,
    scope: { kind: "draft", draftId: draft.id, generation: draft.generation },
  };
}

export function officeSourceBasis(
  source: OfficeSourceDescriptor,
  proof: OfficeTaskProof,
): DraftTarget {
  const target = officeSourceTarget(source, proof);
  if (target.scope.kind !== "draft") throw officeDenied();
  const basis = proof.association.intent.basis;
  if (
    basis !== undefined &&
    (basis.documentId !== target.documentId ||
      basis.draftId !== target.scope.draftId ||
      basis.generation !== target.scope.generation)
  )
    throw officeDenied();
  return {
    documentId: target.documentId,
    draftId: target.scope.draftId,
    generation: target.scope.generation,
    expectedRevision: basis?.expectedRevision ?? 0,
  };
}
