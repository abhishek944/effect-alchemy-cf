import { officeImportOptions } from "@starter/office-contract";
import { DomainUuid } from "./chat-capabilities.ts";
import { createChatLibraryClient } from "./chat-library-client.ts";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";
import { decodeOption } from "./chat-internal.ts";
import { OfficeTaskFile } from "./office-task-file.ts";

/**
 * Resolve one explicitly requested earlier-Send file through the owner+chat catalog.
 * Ready/accepted, unexpired, same chat and supported Office/CSV import policy only; never bytes
 * or a new acceptance. CSV stays a text original, so the catalog kind alone is not the test.
 */
export const readOfficeRetainedOriginal = async (
  env: ConversationFileEnv,
  ownerId: string,
  chatId: string,
  fileId: string,
): Promise<OfficeTaskFile | null> => {
  // A model-supplied selector that is not a chat file ID can never be retained identity.
  const id = decodeOption(DomainUuid, fileId);
  if (env.ChatCatalog === undefined || id === null) return null;
  const stub = env.ChatCatalog.getByName(`owner:${ownerId}`);
  const metadata = await createChatLibraryClient(stub).original(chatId, id);
  if (metadata === null) return null;
  const file = metadata.file;
  if (
    file.id !== id ||
    file.chatId !== chatId ||
    file.state !== "ready" ||
    file.expiresAt !== null ||
    officeImportOptions(file.mediaType, file.name) === null
  )
    return null;
  const retained = decodeOption(OfficeTaskFile, {
    fileId: file.id,
    digest: metadata.digest,
    originOperationId: metadata.originOperationId,
    kind: file.kind,
    name: file.name,
    byteSize: file.byteSize,
    mediaType: file.mediaType,
    width: file.width,
    height: file.height,
  });
  return retained === null ? null : Object.freeze(retained);
};
