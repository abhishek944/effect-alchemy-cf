import {
  ROOT_CONVERSATION_ID,
  UserEntry,
  type ConversationId,
  type EntryRecord,
  type SubmissionId,
} from "@earendil-works/pi-durable";
import type { ImageBoundInput, ImageResponseCandidate } from "./chat-image-response-schema.ts";
import { digestCompactImageInput } from "./chat-image-response-digest.ts";
import type { ImageNativeAccess, ImageNativeContext } from "./chat-image-request-types.ts";
import { imageProofFailure } from "./chat-image-request-values.ts";

export const requireImageAccess = (
  access: ImageNativeAccess,
  context: ImageNativeContext,
): void => {
  context.abortSignal?.throwIfAborted();
  if (
    !access.ready() ||
    access.owner() !== access.ownerId ||
    access.conversationId !== ROOT_CONVERSATION_ID
  )
    imageProofFailure();
};

export const requireImageCandidate = (
  access: ImageNativeAccess,
  candidate: ImageResponseCandidate,
  origin: ConversationId,
): void => {
  if (
    candidate.ownerId !== access.ownerId ||
    candidate.chatId !== access.chatId ||
    candidate.chatScope !== access.chatScope ||
    candidate.conversationId !== String(origin)
  )
    imageProofFailure();
};

/** Validate an immutable sidecar against the real unedited native user slot. */
export const verifyImageBoundEntry = async (
  access: ImageNativeAccess,
  bound: ImageBoundInput,
  entry: EntryRecord,
): Promise<void> => {
  const { candidate, binding } = bound;
  requireImageCandidate(access, candidate, entry.conversationId);
  const message = entry.model?.[binding.modelIndex];
  if (
    !UserEntry.is(entry) ||
    entry.model?.length !== 1 ||
    binding.modelIndex !== 0 ||
    message?.role !== "user" ||
    !Number.isFinite(message.timestamp) ||
    message.timestamp < 0 ||
    binding.entryId !== entry.id ||
    binding.conversationId !== String(entry.conversationId) ||
    binding.operationId !== candidate.operationId ||
    binding.inputDigest !== candidate.inputDigest ||
    (await digestCompactImageInput(message.content)) !== candidate.inputDigest
  )
    imageProofFailure();
};

export type PlacedImageInput = {
  readonly operationId: string;
  readonly submissionId: SubmissionId;
  readonly conversationId: ConversationId;
  readonly entry: EntryRecord;
};

/** Actual placed input identity, with no inferred image/default capability. */
export const readPlacedImageInput = async (
  access: ImageNativeAccess,
  conversationId: ConversationId,
  submissionId: SubmissionId,
  context: ImageNativeContext,
): Promise<PlacedImageInput> => {
  requireImageAccess(access, context);
  if (conversationId !== access.conversationId) imageProofFailure();
  const native = await access.storage.submission(submissionId, context);
  if (
    native === undefined ||
    native.type !== "input" ||
    native.status !== "placed" ||
    native.conversationId !== conversationId ||
    native.requestId === undefined
  )
    return imageProofFailure();
  const accepted = await access.storage.submissionByRequest(
    conversationId,
    native.requestId,
    context,
  );
  if (
    accepted?.type !== "input" ||
    accepted.status !== "placed" ||
    accepted.id !== native.id ||
    accepted.entry !== native.entry ||
    accepted.conversationId !== conversationId ||
    accepted.requestId !== native.requestId
  )
    return imageProofFailure();
  const visible = await access.storage.entry(conversationId, native.entry, context);
  const entry = visible?.entry;
  const message = entry?.model?.[0];
  if (
    entry === undefined ||
    !UserEntry.is(entry) ||
    entry.conversationId !== conversationId ||
    entry.model?.length !== 1 ||
    message?.role !== "user" ||
    !Number.isFinite(message.timestamp) ||
    message.timestamp < 0
  )
    return imageProofFailure();
  requireImageAccess(access, context);
  return { operationId: native.requestId, submissionId: native.id, conversationId, entry };
};

/** Candidate-only image authority: legacy input can NEVER enter this CAS/paid-tool path. */
export const bindNativeImageInput = async (
  access: ImageNativeAccess,
  native: PlacedImageInput,
  context: ImageNativeContext,
): Promise<ImageBoundInput> => {
  const candidate = access.responses.read(native.operationId);
  if (candidate === null) return imageProofFailure();
  requireImageCandidate(access, candidate, native.conversationId);
  const binding = {
    operationId: native.operationId,
    submissionId: String(native.submissionId),
    conversationId: String(native.conversationId),
    entryId: native.entry.id,
    modelIndex: 0,
    inputDigest: candidate.inputDigest,
  };
  await verifyImageBoundEntry(access, { candidate, binding }, native.entry);
  requireImageAccess(access, context);
  return access.responses.bindAccepted(binding);
};

/** Strict image resolver stays separate from the ordinary legacy continuation classifier. */
export const resolveAcceptedImageInput = async (
  access: ImageNativeAccess,
  conversationId: ConversationId,
  submissionId: SubmissionId,
  context: ImageNativeContext,
): Promise<ImageBoundInput> =>
  bindNativeImageInput(
    access,
    await readPlacedImageInput(access, conversationId, submissionId, context),
    context,
  );
