/**
 * Authorize the exact originals of accepted compact messages.
 *
 * Every original is resolved by the owner catalog's immutable same-chat metadata
 * BEFORE the first private byte read. URLs are identifiers only; the retained
 * object key comes from the catalog scope. Office documents stay metadata-only.
 */
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import { chatFilesImageCompatibility } from "./chat-files-image-policy.ts";
import { ImageHydrationError, hydrationSignal } from "./chat-image-hydration-types.ts";
import { digestCompactImageInput } from "./chat-image-response-digest.ts";
import type { ImageOriginalBinding } from "./chat-image-response-schema.ts";
import { chatSdkOwner } from "./chat-sdk-files-types.ts";
import type { ChatSdkAcceptedMessage, ChatSdkFilesDeps } from "./chat-sdk-files-types.ts";
import { createChatLibraryClient } from "./chat-library-client.ts";
import type { SavedOriginalMetadata } from "./chat-library-original.ts";
import { matchingCompactReferenceInput } from "./chat-reference-integrity.ts";

export type AuthorizedMessage = {
  readonly requestIndex: number;
  readonly message: UserMessage;
  readonly candidate: ChatSdkAcceptedMessage["candidate"];
  readonly originals: readonly SavedOriginalMetadata[];
};

const matches = (binding: ImageOriginalBinding, authority: SavedOriginalMetadata): boolean => {
  const file = authority.file;
  return (
    binding.fileId === file.id &&
    binding.originOperationId === authority.originOperationId &&
    binding.kind === file.kind &&
    binding.name === file.name &&
    binding.byteSize === file.byteSize &&
    binding.mediaType === file.mediaType &&
    binding.width === file.width &&
    binding.height === file.height
  );
};

const requireScope = async (
  deps: ChatSdkFilesDeps,
  candidate: ChatSdkAcceptedMessage["candidate"],
): Promise<string> => {
  const owner = chatSdkOwner(deps);
  if (owner === null) throw new ImageHydrationError("invalid_context");
  if (owner !== candidate.ownerId) throw new ImageHydrationError("invalid_context");
  if (deps.chatName() !== `chat:${owner}:${candidate.chatId}`)
    throw new ImageHydrationError("invalid_context");
  if (deps.chatScope() !== candidate.chatScope) throw new ImageHydrationError("invalid_context");
  const conversationId = await deps.conversationId();
  if (conversationId.length === 0 || conversationId !== candidate.conversationId)
    throw new ImageHydrationError("invalid_context");
  return owner;
};

const requireMessage = async (
  deps: ChatSdkFilesDeps,
  item: ChatSdkAcceptedMessage,
  messages: readonly Message[],
): Promise<{ message: UserMessage; owner: string }> => {
  const message = messages[item.requestIndex];
  if (
    message === undefined ||
    !Number.isSafeInteger(item.requestIndex) ||
    item.requestIndex < 0 ||
    message.role !== "user" ||
    !Number.isFinite(message.timestamp) ||
    (Array.isArray(message.content) && message.content.some((block) => block.type !== "text"))
  )
    throw new ImageHydrationError("invalid_context");
  try {
    if (
      !matchingCompactReferenceInput(message.content, item.candidate) ||
      (await digestCompactImageInput(message.content)) !== item.candidate.inputDigest
    )
      throw new ImageHydrationError("invalid_context");
  } catch (error) {
    throw error instanceof ImageHydrationError ? error : new ImageHydrationError("invalid_context");
  }
  return { message, owner: await requireScope(deps, item.candidate) };
};

export type AuthorizeInput = {
  readonly deps: ChatSdkFilesDeps;
  readonly accepted: readonly ChatSdkAcceptedMessage[];
  readonly messages: readonly Message[];
  readonly model: ChatCatalogModel;
  readonly signal?: AbortSignal | undefined;
};

/** Resolve every accepted compact message and all original metadata first. */
export const authorizeAcceptedMessages = async (
  input: AuthorizeInput,
): Promise<readonly AuthorizedMessage[]> => {
  const checked: {
    requestIndex: number;
    message: UserMessage;
    candidate: ChatSdkAcceptedMessage["candidate"];
  }[] = [];
  let previous = -1;
  let owner: string | null = null;
  for (const item of input.accepted) {
    hydrationSignal(input.signal);
    if (item.requestIndex <= previous) throw new ImageHydrationError("invalid_context");
    previous = item.requestIndex;
    const resolved = await requireMessage(input.deps, item, input.messages);
    owner = resolved.owner;
    checked.push({
      requestIndex: item.requestIndex,
      message: resolved.message,
      candidate: item.candidate,
    });
  }
  if (checked.length === 0) return [];
  if (owner === null) throw new ImageHydrationError("invalid_context");
  const library = createChatLibraryClient(input.deps.catalog(owner));
  const result: AuthorizedMessage[] = [];
  for (const entry of checked) {
    const originals: SavedOriginalMetadata[] = [];
    for (const binding of entry.candidate.originals) {
      if (binding.kind === "office") continue;
      hydrationSignal(input.signal);
      const authority = await library.original(entry.candidate.chatId, binding.fileId);
      if (authority === null) throw new ImageHydrationError("metadata_mismatch");
      if (!matches(binding, authority)) throw new ImageHydrationError("metadata_mismatch");
      if (authority.file.state !== "ready" || authority.file.expiresAt !== null)
        throw new ImageHydrationError("original_unavailable");
      const compatibility = chatFilesImageCompatibility([authority.file], input.model);
      if (!compatibility.ok)
        throw new ImageHydrationError(
          compatibility.code === "model_image_unsupported"
            ? "model_image_unsupported"
            : "model_image_limits",
        );
      originals.push(authority);
    }
    result.push({
      requestIndex: entry.requestIndex,
      message: entry.message,
      candidate: entry.candidate,
      originals,
    });
  }
  return result;
};
