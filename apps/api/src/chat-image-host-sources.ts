import { createChatLibraryClient } from "./chat-library-client.ts";
import type { SavedOriginalMetadata } from "./chat-library-original.ts";
import type { ImageOriginalBinding } from "./chat-image-response-schema.ts";
import { requireImageAccess, verifyImageBoundEntry } from "./chat-image-request-accepted.ts";
import type { ProvenImageCall } from "./chat-image-native-proof.ts";
import type {
  ChatImageHostDependencies,
  ImageHostContext,
  ImageHostSource,
} from "./chat-image-host-types.ts";

export const imageHostRefusal = (): never => {
  throw new Error("The image call could not be authorized.");
};

function matches(binding: ImageOriginalBinding, authority: SavedOriginalMetadata): boolean {
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
}

async function allowedOrigin(
  deps: ChatImageHostDependencies,
  proof: ProvenImageCall,
  url: URL,
  authority: SavedOriginalMetadata,
  context: ImageHostContext,
): Promise<boolean> {
  const current = proof.snapshot;
  if (url.origin === current.applicationOrigin) return true;
  if (current.originals.some((source) => source.url === url.href && matches(source, authority)))
    return true;
  const operation = authority.originOperationId;
  if (operation === null) return false;
  const access = deps.proofAccess;
  requireImageAccess(access, context);
  const submission = await deps.storage.submissionByRequest(
    access.conversationId,
    operation,
    context,
  );
  if (
    submission?.type !== "input" ||
    (submission.status !== "placed" &&
      submission.status !== "done" &&
      submission.status !== "unanswered") ||
    submission.entry === undefined ||
    submission.requestId !== operation ||
    submission.conversationId !== access.conversationId
  )
    return false;
  // Boot must already have reconstructed accepted bindings in ascending native order.
  const creator = access.responses.forEntry(String(access.conversationId), submission.entry, 0);
  if (
    creator === null ||
    creator.candidate.operationId !== operation ||
    creator.binding.operationId !== operation ||
    creator.binding.submissionId !== String(submission.id) ||
    creator.binding.entryId !== submission.entry ||
    creator.binding.modelIndex !== 0 ||
    creator.binding.conversationId !== String(access.conversationId)
  )
    return false;
  const visible = await deps.storage.entry(access.conversationId, submission.entry, context);
  if (
    visible === undefined ||
    visible.entry.id !== submission.entry ||
    visible.entry.conversationId !== access.conversationId
  )
    return false;
  // Checks exact native user content/digest and frozen creator owner/chat/conversation scope.
  await verifyImageBoundEntry(access, creator, visible.entry);
  const again = await deps.storage.submissionByRequest(access.conversationId, operation, context);
  requireImageAccess(access, context);
  if (
    again?.type !== "input" ||
    (again.status !== "placed" && again.status !== "done" && again.status !== "unanswered") ||
    again.entry !== submission.entry ||
    again.id !== submission.id ||
    again.requestId !== operation ||
    again.conversationId !== access.conversationId
  )
    return false;
  return (
    creator.candidate.applicationOrigin === url.origin ||
    creator.candidate.originals.some(
      (source) => source.url === url.href && matches(source, authority),
    )
  );
}

/** URLs are immutable identifiers only; original bytes always use the private retained key. */
export async function authorizeImageHostSources(
  deps: ChatImageHostDependencies,
  proof: ProvenImageCall,
  context: ImageHostContext,
): Promise<readonly ImageHostSource[]> {
  const library = createChatLibraryClient(deps.catalog);
  const result: ImageHostSource[] = [];
  for (const value of proof.args.image ?? []) {
    context.abortSignal?.throwIfAborted();
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.href !== value ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    )
      imageHostRefusal();
    const prefix = `/api/chats/${proof.snapshot.chatId}/attachments/`;
    if (!url.pathname.startsWith(prefix)) imageHostRefusal();
    const fileId = url.pathname.slice(prefix.length);
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(fileId)) imageHostRefusal();
    const authority = await library.original(proof.snapshot.chatId, fileId);
    if (
      authority === null ||
      authority.file.id !== fileId ||
      authority.file.chatId !== proof.snapshot.chatId ||
      authority.file.kind !== "image" ||
      authority.file.state !== "ready" ||
      authority.file.expiresAt !== null ||
      !(await allowedOrigin(deps, proof, url, authority, context))
    )
      return imageHostRefusal();
    result.push({ url: value, authority });
  }
  return result;
}
