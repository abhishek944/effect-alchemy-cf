import type { ChatCatalogModel } from "./chat-capabilities.ts";
import { prepareCompactImageInput } from "./chat-image-input-preparation.ts";
import { ImageInputError, type ImageInputPreparationAccess } from "./chat-image-input-types.ts";
import { ImageResponseError } from "./chat-image-response-codec.ts";
import { digestText } from "./chat-internal.ts";
import { ChatInvalid, ChatUnavailable, type SendMessage } from "./chat-model.ts";
import { sendIdentity } from "./chat-send-identity.ts";
import type { ChatSendScope, PreparedChatSend } from "./chat-submission.ts";

/** Actual Send adapter. Caller holds admission and completes reconstruction first. */
export const prepareChatImageSend = async (
  access: ImageInputPreparationAccess,
  input: typeof SendMessage.Type,
  scope: ChatSendScope,
  model: ChatCatalogModel,
): Promise<PreparedChatSend> => {
  try {
    const prepared = await prepareCompactImageInput(access, {
      operationId: input.operationId,
      logicalOperationId: input.operationId,
      identityHash: await digestText(sendIdentity(input)),
      ownerId: scope.ownerId,
      chatId: scope.chat.id,
      applicationOrigin: scope.applicationOrigin,
      text: input.text,
      ...(input.officeTarget === undefined ? {} : { officeTarget: input.officeTarget }),
      sources: [
        ...input.attachments.map((fileId) => ({ source: "upload" as const, fileId })),
        ...(input.references ?? []).map((fileId) => ({ source: "saved" as const, fileId })),
      ],
      model,
    });
    return { content: prepared.content, files: prepared.files };
  } catch (error) {
    if (
      (error instanceof ImageInputError || error instanceof ImageResponseError) &&
      (error.code === "invalid_input" || error.code === "conflict")
    )
      throw new ChatInvalid({
        message:
          "The saved references or staged uploads do not match this message. Your originals are unchanged.",
      });
    throw new ChatUnavailable();
  }
};
