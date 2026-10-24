import type { BoundAcceptedInput } from "./chat-accepted-input-schema.ts";
import {
  requireAcceptedInputAccess,
  verifyAcceptedInputEntry,
  type AcceptedInputAccess,
  type AcceptedInputContext,
} from "./chat-accepted-input.ts";
import { createChatFilesCatalogClient } from "./chat-files-client.ts";
import { retainChatFiles } from "./chat-files-retain.ts";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";

const unavailable = (): never => {
  throw new Error("Accepted originals could not be retained.");
};

/**
 * Reconcile only the actual creator's uploads after exact native accepted evidence.
 * Shared by image repair and Office original reads; neither capability may synthesize this proof.
 */
export const retainAcceptedOriginals = async (
  access: AcceptedInputAccess,
  env: ConversationFileEnv,
  bound: BoundAcceptedInput,
  context: AcceptedInputContext,
): Promise<void> => {
  requireAcceptedInputAccess(access, context);
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
  await verifyAcceptedInputEntry(access, bound, visible.entry);
  const fileIds = candidate.originals
    .filter((original) => original.originOperationId === candidate.operationId)
    .map((original) => original.fileId);
  if (fileIds.length === 0) return;
  if (env.ChatCatalog === undefined || env.CHAT_FILES === undefined) return unavailable();
  requireAcceptedInputAccess(access, context);
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
  requireAcceptedInputAccess(access, context);
};
