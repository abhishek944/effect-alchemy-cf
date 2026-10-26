import {
  ROOT_CONVERSATION_ID,
  UserEntry,
  type ConversationId,
  type EntryRecord,
  type Storage,
  type SubmissionId,
} from "@earendil-works/pi-durable";
import type {
  AcceptedInputBinding,
  AcceptedInputRecord,
  BoundAcceptedInput,
} from "./chat-accepted-input-schema.ts";
export type {
  AcceptedInputBinding,
  AcceptedInputRecord,
  AcceptedOriginalBinding,
  BoundAcceptedInput,
} from "./chat-accepted-input-schema.ts";
import { acceptedInputFailure } from "./chat-accepted-input-values.ts";
import { matchingCompactReferenceInput } from "./chat-reference-integrity.ts";
import { digestCompactImageInput } from "./chat-image-response-digest.ts";

export type AcceptedInputContext = Parameters<Storage["task"]>[1];

/** Narrow accepted-input view of whatever immutable record store the capability owns. */
export type AcceptedInputStore<Record extends AcceptedInputRecord = AcceptedInputRecord> = {
  readonly read: (operationId: string) => Record | null;
  readonly bindAccepted: (binding: AcceptedInputBinding) => BoundAcceptedInput<Record>;
};

/**
 * Feature-neutral accepted-send authority. Image capability, Office reads and ordinary chat
 * share this scope; none of them may mint it from model text, a submission ID or a digest.
 */
export type AcceptedInputAccess<Record extends AcceptedInputRecord = AcceptedInputRecord> = {
  readonly storage: Storage;
  readonly inputs: AcceptedInputStore<Record>;
  readonly ownerId: string;
  readonly chatId: string;
  readonly chatScope: string;
  readonly conversationId: ConversationId;
  readonly owner: () => string | null;
  readonly ready: () => boolean;
};

export const requireAcceptedInputAccess = (
  access: AcceptedInputAccess,
  context: AcceptedInputContext,
): void => {
  context.abortSignal?.throwIfAborted();
  if (
    !access.ready() ||
    access.owner() !== access.ownerId ||
    access.conversationId !== ROOT_CONVERSATION_ID
  )
    acceptedInputFailure();
};

export const requireAcceptedInputCandidate = (
  access: AcceptedInputAccess,
  candidate: AcceptedInputRecord,
  origin: ConversationId,
): void => {
  if (
    candidate.ownerId !== access.ownerId ||
    candidate.chatId !== access.chatId ||
    candidate.chatScope !== access.chatScope ||
    candidate.conversationId !== String(origin)
  )
    acceptedInputFailure();
};

/** Validate an immutable record against the real unedited native user slot. */
export const verifyAcceptedInputEntry = async (
  access: AcceptedInputAccess,
  bound: BoundAcceptedInput,
  entry: EntryRecord,
): Promise<void> => {
  const { candidate, binding } = bound;
  requireAcceptedInputCandidate(access, candidate, entry.conversationId);
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
    !matchingCompactReferenceInput(message.content, candidate) ||
    (await digestCompactImageInput(message.content)) !== candidate.inputDigest
  )
    acceptedInputFailure();
};

export type PlacedAcceptedInput = {
  readonly operationId: string;
  readonly submissionId: SubmissionId;
  readonly conversationId: ConversationId;
  readonly entry: EntryRecord;
};

/** Actual placed input identity, with no inferred capability or default model. */
export const readPlacedAcceptedInput = async (
  access: AcceptedInputAccess,
  conversationId: ConversationId,
  submissionId: SubmissionId,
  context: AcceptedInputContext,
): Promise<PlacedAcceptedInput> => {
  requireAcceptedInputAccess(access, context);
  if (conversationId !== access.conversationId) acceptedInputFailure();
  const native = await access.storage.submission(submissionId, context);
  if (
    native === undefined ||
    native.type !== "input" ||
    native.status !== "placed" ||
    native.conversationId !== conversationId ||
    native.requestId === undefined
  )
    return acceptedInputFailure();
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
    return acceptedInputFailure();
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
    return acceptedInputFailure();
  requireAcceptedInputAccess(access, context);
  return { operationId: native.requestId, submissionId: native.id, conversationId, entry };
};

/** Bind the exact placed native input to its accepted record. Never rebind bytes. */
export const bindPlacedAcceptedInput = async <Record extends AcceptedInputRecord>(
  access: AcceptedInputAccess<Record>,
  native: PlacedAcceptedInput,
  context: AcceptedInputContext,
): Promise<BoundAcceptedInput<Record>> => {
  const candidate = access.inputs.read(native.operationId);
  if (candidate === null) return acceptedInputFailure();
  requireAcceptedInputCandidate(access, candidate, native.conversationId);
  const binding = {
    operationId: native.operationId,
    submissionId: String(native.submissionId),
    conversationId: String(native.conversationId),
    entryId: native.entry.id,
    modelIndex: 0,
    inputDigest: candidate.inputDigest,
  };
  await verifyAcceptedInputEntry(access, { candidate, binding }, native.entry);
  requireAcceptedInputAccess(access, context);
  return access.inputs.bindAccepted(binding);
};

export const resolveAcceptedInput = async <Record extends AcceptedInputRecord>(
  access: AcceptedInputAccess<Record>,
  conversationId: ConversationId,
  submissionId: SubmissionId,
  context: AcceptedInputContext,
): Promise<BoundAcceptedInput<Record>> =>
  bindPlacedAcceptedInput(
    access,
    await readPlacedAcceptedInput(access, conversationId, submissionId, context),
    context,
  );
