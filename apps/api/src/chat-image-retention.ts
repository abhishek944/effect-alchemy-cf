import type { ImageBoundInput } from "./chat-image-response-schema.ts";
import type {
  GenerationRequestProof,
  ImageNativeAccess,
  ImageNativeContext,
} from "./chat-image-request-types.ts";
import { requireImageAccess, verifyImageBoundEntry } from "./chat-image-request-accepted.ts";
import { createChatFilesCatalogClient } from "./chat-files-client.ts";
import { retainChatFiles } from "./chat-files-retain.ts";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";

const unavailable = (): never => {
  throw new Error("Accepted originals could not be retained.");
};

/** Reconcile only the actual creator's uploads after exact native accepted evidence. */
export const retainAcceptedImageInput = async (
  access: ImageNativeAccess,
  env: ConversationFileEnv,
  bound: ImageBoundInput,
  context: ImageNativeContext,
): Promise<void> => {
  requireImageAccess(access, context);
  const { candidate, binding } = bound;
  const record = await access.storage.submissionByRequest(
    access.conversationId,
    candidate.operationId,
    context,
  );
  if (
    record?.type !== "input" ||
    record.status === "queued" ||
    record.requestId !== candidate.operationId ||
    record.entry !== binding.entryId ||
    record.conversationId !== access.conversationId ||
    String(record.id) !== binding.submissionId
  )
    unavailable();
  const entryId = record?.type === "input" && record.status !== "queued" ? record.entry : undefined;
  if (entryId === undefined) return unavailable();
  const visible = await access.storage.entry(access.conversationId, entryId, context);
  if (visible === undefined) return unavailable();
  await verifyImageBoundEntry(access, bound, visible.entry);
  const fileIds = candidate.originals
    .filter((original) => original.originOperationId === candidate.operationId)
    .map((original) => original.fileId);
  if (fileIds.length === 0) return;
  if (env.ChatCatalog === undefined || env.CHAT_FILES === undefined) return unavailable();
  requireImageAccess(access, context);
  const catalog = createChatFilesCatalogClient(
    env.ChatCatalog.getByName(`owner:${access.ownerId}`),
  );
  const result = await retainChatFiles({
    bucket: env.CHAT_FILES,
    catalog,
    scope: catalog.scope,
    chatId: candidate.chatId,
    operationId: candidate.operationId,
    fileIds,
    now: Date.now(),
  });
  if (!result.ok) unavailable();
  requireImageAccess(access, context);
};

/** Exact proven occurrence lookup, not captions or metadata text parsed as authority. */
export const repairImageRequestOriginals = async (
  access: ImageNativeAccess,
  env: ConversationFileEnv,
  proof: GenerationRequestProof,
  context: ImageNativeContext,
): Promise<void> => {
  const repaired = new Set<string>();
  for (const occurrence of proof.inputs) {
    const bound = access.responses.forEntry(
      String(occurrence.originConversationId),
      occurrence.entryId,
      occurrence.modelIndex,
    );
    if (bound === null) return unavailable();
    if (repaired.has(bound.candidate.operationId)) continue;
    await retainAcceptedImageInput(access, env, bound, context);
    repaired.add(bound.candidate.operationId);
  }
};
