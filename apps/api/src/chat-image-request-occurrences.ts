import { UserEntry, type ContextView, type ConversationId } from "@earendil-works/pi-durable";
import type { Message } from "@earendil-works/pi-ai";
import type {
  InputOccurrence,
  ImageNativeContext,
  ImageRequestAccess,
} from "./chat-image-request-types.ts";
import { requireImageAccess, verifyImageBoundEntry } from "./chat-image-request-accepted.ts";
import {
  imageProofFailure,
  MAX_IMAGE_PROOF_CHARACTERS,
  sameImageRequestValue,
} from "./chat-image-request-values.ts";

/** Native contribution identity is used ONLY inside this single exact-cutoff view. */
export const mapImageInputOccurrences = async (
  access: ImageRequestAccess,
  conversationId: ConversationId,
  view: ContextView,
  context: ImageNativeContext,
): Promise<readonly InputOccurrence[]> => {
  if (view.entries.length !== view.contributions.length) imageProofFailure();
  const positions = new Map<Message, number[]>();
  view.messages.forEach((message, index) => {
    const existing = positions.get(message);
    if (existing === undefined) positions.set(message, [index]);
    else existing.push(index);
  });
  const claimed = new Set<number>();
  const occurrences: InputOccurrence[] = [];
  let metadataCharacters = 0;
  for (let index = 0; index < view.entries.length; index++) {
    requireImageAccess(access, context);
    const entry = view.entries[index];
    if (!UserEntry.is(entry)) continue; // Real summary/handoff kinds have no source authority.
    const bound = access.responses.forEntry(String(entry.conversationId), entry.id, 0);
    if (bound === null) {
      if (
        access.responses.isImageEra(String(entry.conversationId), entry.id) ||
        !access.legacyEra?.allows(access, entry.id)
      )
        imageProofFailure();
      continue; // Only proven pre-activation history stays inline; unknown missing metadata is denied.
    }
    const visible = await access.storage.entry(conversationId, entry.id, context);
    if (
      visible === undefined ||
      visible.entry.conversationId !== entry.conversationId ||
      !sameImageRequestValue(visible.entry, entry)
    )
      return imageProofFailure();
    const native = await access.storage.submissionByRequest(
      entry.conversationId,
      bound.binding.operationId,
      context,
    );
    if (
      native?.type !== "input" ||
      native.entry !== entry.id ||
      native.conversationId !== entry.conversationId ||
      native.requestId !== bound.binding.operationId ||
      String(native.id) !== bound.binding.submissionId
    )
      return imageProofFailure();
    await verifyImageBoundEntry(access, bound, visible.entry);
    const raw = entry.model?.[bound.binding.modelIndex];
    const contribution = view.contributions[index];
    if (
      raw === undefined ||
      contribution === undefined ||
      contribution.length !== 1 ||
      contribution[0] !== raw
    )
      return imageProofFailure(); // Omitted/replaced input must never keep attachment authority.
    const indexes = positions.get(raw);
    if (indexes === undefined || indexes.length === 0) return imageProofFailure();
    for (const requestIndex of indexes) {
      // Bound aggregate metadata while building, not after retaining every sidecar.
      metadataCharacters += 256;
      for (const original of bound.candidate.originals) {
        metadataCharacters +=
          256 +
          original.url.length +
          original.name.length +
          original.mediaType.length +
          original.digest.length +
          original.fileId.length +
          (original.originOperationId?.length ?? 0);
      }
      metadataCharacters += JSON.stringify(bound.candidate.referenceInputs ?? []).length;
      if (metadataCharacters > MAX_IMAGE_PROOF_CHARACTERS || claimed.has(requestIndex))
        imageProofFailure();
      claimed.add(requestIndex);
      occurrences.push({
        requestIndex,
        entryId: entry.id,
        modelIndex: bound.binding.modelIndex,
        originConversationId: entry.conversationId,
        originals: bound.candidate.originals,
        ...(bound.candidate.referenceInputs === undefined
          ? {}
          : { referenceInputs: bound.candidate.referenceInputs }),
      });
    }
  }
  requireImageAccess(access, context);
  return occurrences.toSorted((left, right) => left.requestIndex - right.requestIndex);
};
