import type { AcceptedOfficeFile, OfficeResolution } from "@starter/office-pi";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";
import { holdFileBody } from "./chat-file-io-body.ts";
import { ChatFileIOUnavailable, withFileMemory } from "./chat-file-io-memory.ts";
import { openFileObject, statFileObject } from "./chat-file-io-objects.ts";
import { createChatFilesCatalogClient } from "./chat-files-client.ts";
import { retainedObjectKey } from "./chat-files-store.ts";
import { createChatLibraryClient } from "./chat-library-client.ts";
import { retainAcceptedImageInput } from "./chat-image-retention.ts";
import type { ImageNativeAccess } from "./chat-image-request-types.ts";
import { resolveOfficeCall } from "./chat-office-native-proof.ts";

const unavailable = (): never => {
  throw new ChatFileIOUnavailable();
};

/** Private lineage/bytes only; the real host still owns principal/session/final authority. */
export async function readOfficeAcceptedFile(
  resolution: OfficeResolution,
  access: ImageNativeAccess,
  env: ConversationFileEnv,
  fileRef: string,
  cancellation: AbortSignal,
): Promise<AcceptedOfficeFile> {
  const signal =
    resolution.context.abortSignal === undefined
      ? cancellation
      : AbortSignal.any([resolution.context.abortSignal, cancellation]);
  signal.throwIfAborted();
  const { api, context, intent } = resolution;
  if (intent.command.command !== "stage-file" || intent.command.input.fileRef !== fileRef)
    return unavailable();
  const proof = await resolveOfficeCall(api, context, intent, access);
  signal.throwIfAborted();
  const original = proof?.current.candidate.originals.find((file) => file.fileId === fileRef);
  if (proof === null || original?.kind !== "office") return unavailable();
  if (env.ChatCatalog === undefined || env.CHAT_FILES === undefined) return unavailable();
  // Repair only uploads already proved accepted by their actual native creator, never ready IDs.
  await retainAcceptedImageInput(access, env, proof.current, context);
  signal.throwIfAborted();
  const stub = env.ChatCatalog.getByName(`owner:${access.ownerId}`);
  const catalog = createChatFilesCatalogClient(stub);
  const metadata = await createChatLibraryClient(stub).original(access.chatId, original.fileId);
  signal.throwIfAborted();
  if (metadata === null) return unavailable();
  const file = metadata.file;
  if (
    metadata.digest !== original.digest ||
    metadata.originOperationId !== original.originOperationId ||
    file.chatId !== access.chatId ||
    file.id !== original.fileId ||
    file.state !== "ready" ||
    file.expiresAt !== null ||
    file.kind !== original.kind ||
    file.name !== original.name ||
    file.byteSize !== original.byteSize ||
    file.mediaType !== original.mediaType ||
    file.width !== original.width ||
    file.height !== original.height
  )
    return unavailable();
  const key = retainedObjectKey(catalog.scope, file.chatId, file.id);
  const bucket = env.CHAT_FILES;
  const head = await statFileObject(bucket, key, file);
  signal.throwIfAborted();
  if (head === null) return unavailable();
  return withFileMemory(file.kind, file.byteSize, async (lease) => {
    signal.throwIfAborted();
    const object = await openFileObject(bucket, key, head, file);
    if (object === null) return unavailable();
    const held = await holdFileBody(object.body, file.byteSize, lease, signal);
    try {
      if (
        object.key !== key ||
        object.range !== undefined ||
        (object.httpMetadata?.contentEncoding !== undefined &&
          object.httpMetadata.contentEncoding !== "identity") ||
        (object.customMetadata?.digest !== undefined &&
          object.customMetadata.digest !== original.digest)
      )
        return unavailable();
      const current = await resolveOfficeCall(api, context, intent, access);
      signal.throwIfAborted();
      const next = current?.current.candidate.originals.find((entry) => entry.fileId === fileRef);
      if (
        current === null ||
        current.submissionId !== proof.submissionId ||
        current.generationTaskId !== proof.generationTaskId ||
        next === undefined ||
        Object.entries(original).some(([name, value]) => Reflect.get(next, name) !== value)
      )
        return unavailable();
      // Expected digest is accepted metadata, not a claim this counted stream hashes content.
      // The existing staging uploader must verify actual bytes before acknowledging that digest.
      return {
        filename: file.name,
        bytes: file.byteSize,
        digest: original.digest,
        body: held.body,
      };
    } catch (error) {
      await held.cancel();
      throw error;
    }
  });
}
