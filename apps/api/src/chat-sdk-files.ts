/**
 * Worker-side compact file adapter for the real Node SDK host.
 *
 * `prepare` freezes one operation's uploads, saved references and image
 * preferences. `accept` runs only after the transcript accepts the exact input:
 * it binds the immutable candidate and promotes the creator's staged uploads.
 * `release` clears only still-unaccepted staged bindings. `hydrate` is the final
 * model-request step that loads authorized original bytes and quoted text.
 */
import { createChatFilesCatalogClient } from "./chat-files-client.ts";
import { retainChatFiles } from "./chat-files-retain.ts";
import { createChatSdkHydration } from "./chat-sdk-files-hydrate.ts";
import { ChatSdkFilesError } from "./chat-sdk-files-types.ts";
import { translated } from "./chat-sdk-files-input.ts";
import type { FileDescriptor } from "./chat-attachment-schema.ts";
import { prepareChatSdkFiles } from "./chat-sdk-files-prepare.ts";
import type { ChatSdkFiles, ChatSdkFilesDeps } from "./chat-sdk-files-types.ts";

const retain = async (
  deps: ChatSdkFilesDeps,
  operationId: string,
): Promise<readonly FileDescriptor[]> => {
  const candidate = deps.responses.read(operationId);
  if (candidate === null) throw new ChatSdkFilesError("conflict");
  const uploads = candidate.originals
    .filter((original) => original.originOperationId === operationId)
    .map((original) => original.fileId);
  if (uploads.length === 0) return [];
  const catalog = createChatFilesCatalogClient(deps.catalog(candidate.ownerId));
  const retained = await retainChatFiles({
    bucket: deps.bucket,
    catalog,
    scope: catalog.scope,
    chatId: candidate.chatId,
    operationId,
    fileIds: uploads,
    now: Date.now(),
  });
  if (!retained.ok) throw new ChatSdkFilesError("unavailable");
  return retained.value;
};

const accept = async (deps: ChatSdkFilesDeps, operationId: string, entryId: number) => {
  const candidate = deps.responses.read(operationId);
  if (candidate === null) throw new ChatSdkFilesError("conflict");
  const conversationId = await deps.conversationId();
  if (conversationId.length === 0) throw new ChatSdkFilesError("unavailable");
  let accepted: ReturnType<ChatSdkFilesDeps["responses"]["bindAccepted"]>;
  try {
    accepted = deps.responses.bindAccepted({
      operationId,
      // The new transcript has no native SubmissionId; the operation is the exact input identity.
      submissionId: operationId,
      conversationId,
      entryId,
      modelIndex: 0,
      inputDigest: candidate.inputDigest,
    });
  } catch (error) {
    throw translated(error);
  }
  // The binding is already immutable; a failed promotion can be retried by acceptance repair.
  await retain(deps, operationId);
  return accepted;
};

const release = async (deps: ChatSdkFilesDeps, operationId: string, chatId: string) => {
  const candidate = deps.responses.read(operationId);
  if (candidate === null || candidate.chatId !== chatId) throw new ChatSdkFilesError("conflict");
  const catalog = createChatFilesCatalogClient(deps.catalog(candidate.ownerId));
  const released = await catalog.release({ operationId, chatId, now: Date.now() });
  if (!released.ok)
    throw new ChatSdkFilesError(
      released.code === "invalid_input" ? "invalid_input" : "unavailable",
    );
};

/** One factory for prepare, acceptance, rejection and final-request hydration. */
export const createChatSdkFiles = (deps: ChatSdkFilesDeps): ChatSdkFiles => ({
  prepare: (input, scope, model) => prepareChatSdkFiles(deps, input, scope, model),
  accept: (operationId, entryId) => accept(deps, operationId, entryId),
  retain: (operationId) => retain(deps, operationId),
  release: (operationId, chatId) => release(deps, operationId, chatId),
  hydrate: createChatSdkHydration(deps),
});
