/**
 * Authorize model-supplied edit sources without fetching their URLs.
 *
 * A URL is only a same-chat immutable file identifier. The owner catalog proves
 * the saved image's chat, retained state and creator, and the transcript proves
 * that creator operation was accepted. Bytes always come from the private
 * retained key; arbitrary remote URLs and other chats are refused.
 */
import { createChatLibraryClient } from "./chat-library-client.ts";
import type { SavedOriginalMetadata } from "./chat-library-original.ts";
import type { ImageOriginalBinding, ImageResponseCandidate } from "./chat-image-response-schema.ts";
import { ChatSdkFilesError } from "./chat-sdk-files-types.ts";
import type { ChatSdkImagesDeps } from "./chat-sdk-files-types.ts";

export type ImageHostSource = {
  readonly url: string;
  readonly authority: SavedOriginalMetadata;
};

const refuse = (): never => {
  throw new ChatSdkFilesError("gate");
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

const identity = (
  value: string,
  candidate: ImageResponseCandidate,
): { readonly url: URL; readonly fileId: string } => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return refuse();
  }
  const prefix = `/api/chats/${candidate.chatId}/attachments/`;
  const fileId = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.href !== value ||
    fileId.length === 0 ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(fileId)
  )
    return refuse();
  const current = candidate.originals.some((file) => file.fileId === fileId && file.url === value);
  if (url.origin !== candidate.applicationOrigin && !current) return refuse();
  return { url, fileId };
};

export const authorizeImageSources = async (
  deps: ChatSdkImagesDeps,
  candidate: ImageResponseCandidate,
  values: readonly string[] | undefined,
  signal?: AbortSignal,
): Promise<readonly ImageHostSource[]> => {
  if (values === undefined) return [];
  const owner = candidate.ownerId;
  const library = createChatLibraryClient(deps.catalog(owner));
  const result: ImageHostSource[] = [];
  for (const value of values) {
    signal?.throwIfAborted();
    const parsed = identity(value, candidate);
    const authority = await library.original(candidate.chatId, parsed.fileId);
    signal?.throwIfAborted();
    if (
      authority === null ||
      authority.file.id !== parsed.fileId ||
      authority.file.chatId !== candidate.chatId ||
      authority.file.kind !== "image" ||
      authority.file.state !== "ready" ||
      authority.file.expiresAt !== null
    )
      return refuse();
    const current = candidate.originals.find((file) => file.fileId === parsed.fileId);
    if (current !== undefined && !matches(current, authority)) return refuse();
    const origin = authority.originOperationId;
    if (origin === null) {
      if (current === undefined) return refuse();
    } else if (origin !== candidate.operationId && !deps.isAcceptedOperation(origin)) {
      return refuse();
    }
    result.push({ url: value, authority });
  }
  return result;
};
