import type * as cf from "@cloudflare/workers-types";
import type { ReadImageContextEvidence } from "./chat-image-context.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import { createChatFilesCatalogClient } from "./chat-files-client.ts";
import { prepareChatFiles } from "./chat-files-native.ts";
import { retainChatFiles } from "./chat-files-retain.ts";
import { chatFilesImageCompatibility } from "./chat-files-native.ts";
import { PI_BACKGROUND, type ChatRuntime } from "./chat-runtime.ts";
import { ChatInvalid, ChatUnavailable, type SendMessage } from "./chat-model.ts";
import type { ChatSendScope, PreparedChatSend } from "./chat-submission.ts";

export type ConversationFileEnv = {
  ChatCatalog?: cf.DurableObjectNamespace;
  CHAT_FILES?: cf.R2Bucket;
};

const filesFor = (env: ConversationFileEnv, ownerId: string) => {
  if (env.ChatCatalog === undefined || env.CHAT_FILES === undefined) throw new ChatUnavailable();
  return {
    bucket: env.CHAT_FILES,
    catalog: createChatFilesCatalogClient(env.ChatCatalog.getByName(`owner:${ownerId}`)),
  };
};

export const prepareConversationFiles = async (
  env: ConversationFileEnv,
  input: typeof SendMessage.Type,
  scope: ChatSendScope,
  model: ChatCatalogModel,
): Promise<PreparedChatSend> => {
  if (input.references?.length)
    throw new ChatInvalid({ message: "Saved references require the compact input path." });
  if (input.attachments.length === 0) return { content: input.text, files: [] };
  const { bucket, catalog } = filesFor(env, scope.ownerId);
  const result = await prepareChatFiles({
    bucket,
    catalog,
    scope: catalog.scope,
    chatId: scope.chat.id,
    operationId: input.operationId,
    text: input.text,
    attachments: input.attachments,
    model,
    now: Date.now(),
  });
  if (result.ok) return result.value;
  if (result.code === "unavailable") throw new ChatUnavailable();
  const message =
    result.code === "native_storage_limit"
      ? "These originals exceed this runtime's 1.75 MiB message storage limit. Remove files or choose smaller originals; nothing was resized."
      : `These files cannot be sent: ${result.code.replaceAll("_", " ")}. Your draft and originals are unchanged.`;
  throw new ChatInvalid({ message });
};

/** Promote bytes before accepting metadata; a lost reply repairs the same operation. */
export const retainConversationFiles = async (
  env: ConversationFileEnv,
  input: typeof SendMessage.Type,
  scope: ChatSendScope,
): Promise<void> => {
  if (input.attachments.length === 0) return;
  const { bucket, catalog } = filesFor(env, scope.ownerId);
  const result = await retainChatFiles({
    bucket,
    scope: catalog.scope,
    catalog,
    chatId: scope.chat.id,
    operationId: input.operationId,
    fileIds: input.attachments,
    now: Date.now(),
  });
  if (!result.ok) throw new ChatUnavailable();
};

/** Check original dimensions against the next model without rewriting native history. */
export const validateChatImageContext = async (
  runtime: ChatRuntime,
  model: ChatCatalogModel,
  readEvidence: ReadImageContextEvidence,
): Promise<void> => {
  await runtime.reconcile();
  const view = await (await runtime.conversation()).context(PI_BACKGROUND);
  const evidence = await readEvidence(view);
  if (evidence === null)
    throw new ChatInvalid({
      message: "File metadata is still being reconciled. Reload this chat before changing models.",
    });
  const originals = evidence.flatMap((occurrence) => occurrence.originals);
  const images =
    originals.some((file) => file.kind === "image") ||
    view.messages.some(
      (message) =>
        Array.isArray(message.content) && message.content.some((part) => part.type === "image"),
    );
  if (!images) return;
  if (!model.imageInput)
    throw new ChatInvalid({
      message:
        "This model cannot use the images in this chat. Choose an image-capable model or start a new chat.",
    });
  const files = [];
  for (const entry of view.entries) {
    const entryImages = entry.model?.some(
      (message) =>
        Array.isArray(message.content) && message.content.some((part) => part.type === "image"),
    );
    if (!entryImages) continue;
    const input = await runtime.publicInput(entry.id);
    if (input === null || !input.files.some((file) => file.kind === "image"))
      throw new ChatInvalid({
        message:
          "Image metadata is still being reconciled. Reload this chat before changing models.",
      });
    files.push(...input.files);
  }
  const result = chatFilesImageCompatibility([...files, ...originals], model);
  if (!result.ok)
    throw new ChatInvalid({
      message:
        "Images already in this chat exceed this model’s original-image limits. Choose another model or start a new chat; nothing was resized.",
    });
};

export const releaseConversationFiles = async (
  env: ConversationFileEnv,
  input: typeof SendMessage.Type,
  scope: ChatSendScope,
): Promise<void> => {
  if (input.attachments.length === 0) return;
  const { catalog } = filesFor(env, scope.ownerId);
  const result = await catalog.release({
    operationId: input.operationId,
    chatId: scope.chat.id,
    now: Date.now(),
  });
  if (!result.ok) throw new ChatUnavailable();
};
