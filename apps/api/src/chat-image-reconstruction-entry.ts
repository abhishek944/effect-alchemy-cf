import { UserEntry, type Storage } from "@earendil-works/pi-durable";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_ATTACHMENT_BYTES,
} from "./chat-attachment-schema.ts";
import { matchingCompactReferenceInput } from "./chat-reference-integrity.ts";
import { digestCompactImageInput } from "./chat-image-response-digest.ts";
import type { ImageAcceptedBinding, ImageResponseCandidate } from "./chat-image-response-schema.ts";
import { requireImageInputOwner } from "./chat-image-input-content.ts";
import { ImageInputError, type ImageInputAccess } from "./chat-image-input-types.ts";

export type ImageReconstructionContext = Parameters<Storage["submissionByRequest"]>[2];
export type ImageReconstructionAccess = ImageInputAccess & {
  readonly storage: Storage;
  readonly ownerId: string;
  readonly chatId: string;
  /** Parent readiness AND admission stay closed; this never calls PiHarness.pi(). */
  readonly closed: () => boolean;
};
export type ImageReconstructionEvidence =
  | { readonly state: "absent" }
  | { readonly state: "unplaced" }
  | { readonly state: "accepted"; readonly binding: ImageAcceptedBinding };

export function requireReconstructionClosed(access: ImageReconstructionAccess): void {
  if (!access.closed()) throw new ImageInputError("gate_open");
  requireImageInputOwner(access, access.ownerId, access.chatId);
}

function requireCandidate(
  access: ImageReconstructionAccess,
  candidate: ImageResponseCandidate,
): void {
  requireImageInputOwner(access, access.ownerId, access.chatId, candidate.chatScope);
  if (
    candidate.ownerId !== access.ownerId ||
    candidate.chatId !== access.chatId ||
    candidate.conversationId !== String(access.conversationId) ||
    candidate.originals.length > MAX_ATTACHMENTS_PER_MESSAGE ||
    candidate.originals.reduce((total, file) => total + file.byteSize, 0) >
      MAX_MESSAGE_ATTACHMENT_BYTES
  )
    throw new ImageInputError("corrupt");
}

/** Exact raw native evidence. Undefined is NOT the same as admitted-but-queued. */
export async function inspectImageCandidate(
  access: ImageReconstructionAccess,
  operationId: string,
  context: ImageReconstructionContext,
): Promise<ImageReconstructionEvidence> {
  context.abortSignal?.throwIfAborted();
  requireReconstructionClosed(access);
  const candidate = access.responses.read(operationId);
  if (candidate === null) throw new ImageInputError("corrupt");
  requireCandidate(access, candidate);
  const native = await access.storage.submissionByRequest(
    access.conversationId,
    operationId,
    context,
  );
  requireReconstructionClosed(access);
  if (native === undefined) return { state: "absent" };
  if (
    native.type !== "input" ||
    native.conversationId !== access.conversationId ||
    native.requestId !== operationId
  )
    throw new ImageInputError("corrupt");
  if (native.status === "queued") throw new ImageInputError("queued");
  if (native.status === "unanswered" && native.entry === undefined) return { state: "unplaced" };
  const entryId = native.entry;
  if (entryId === undefined) throw new ImageInputError("corrupt");
  const visible = await access.storage.entry(access.conversationId, entryId, context);
  const entry = visible?.entry;
  const message = entry?.model?.[0];
  if (
    !UserEntry.is(entry) ||
    entry.id !== entryId ||
    entry.conversationId !== access.conversationId ||
    entry.model?.length !== 1 ||
    message?.role !== "user" ||
    !Number.isFinite(message.timestamp) ||
    message.timestamp < 0 ||
    !matchingCompactReferenceInput(message.content, candidate) ||
    (await digestCompactImageInput(message.content)) !== candidate.inputDigest
  )
    throw new ImageInputError("corrupt");
  const again = await access.storage.submissionByRequest(
    access.conversationId,
    operationId,
    context,
  );
  context.abortSignal?.throwIfAborted();
  requireReconstructionClosed(access);
  if (
    again?.type !== "input" ||
    again.status === "queued" ||
    again.id !== native.id ||
    again.entry !== entryId ||
    again.requestId !== operationId ||
    again.conversationId !== access.conversationId
  )
    throw new ImageInputError("corrupt");
  return {
    state: "accepted",
    binding: {
      operationId,
      submissionId: String(native.id),
      conversationId: String(access.conversationId),
      entryId,
      modelIndex: 0,
      inputDigest: candidate.inputDigest,
    },
  };
}
