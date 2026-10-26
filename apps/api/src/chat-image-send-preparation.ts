import { freezeChatReferenceInputs, freezeOfficeSendTarget } from "@starter/office-contract";
import { admitNativeReferences } from "./chat-reference-native-admission.ts";
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
  request: typeof SendMessage.Type,
  scope: ChatSendScope,
  model: ChatCatalogModel,
): Promise<PreparedChatSend> => {
  try {
    const input = Object.freeze({
      ...request,
      selection: Object.freeze({ ...request.selection }),
      attachments: Object.freeze([...request.attachments]),
      ...(request.references === undefined
        ? {}
        : { references: Object.freeze([...request.references]) }),
      ...(request.officeTarget === undefined
        ? {}
        : { officeTarget: freezeOfficeSendTarget({ ...request.officeTarget }) }),
      ...(request.referenceInputs === undefined
        ? {}
        : { referenceInputs: freezeChatReferenceInputs(request.referenceInputs) }),
    });
    const prepared = await prepareCompactImageInput(access, {
      operationId: input.operationId,
      logicalOperationId: input.operationId,
      identityHash: await digestText(sendIdentity(input)),
      ownerId: scope.ownerId,
      chatId: scope.chat.id,
      applicationOrigin: scope.applicationOrigin,
      text: input.text,
      ...(input.officeTarget === undefined ? {} : { officeTarget: input.officeTarget }),
      ...(input.referenceInputs === undefined ? {} : { referenceInputs: input.referenceInputs }),
      sources: [
        ...input.attachments.map((fileId) => ({ source: "upload" as const, fileId })),
        ...[
          ...new Set([
            ...(input.references ?? []),
            ...(input.referenceInputs ?? []).flatMap((ref) =>
              ref.kind === "original" ? [ref.fileId] : [],
            ),
          ]),
        ].map((fileId) => ({ source: "saved" as const, fileId })),
      ],
      model,
    });
    // Ordinary Send preparation is reached only after exact native-accepted repair returned.
    // Revalidate even a persisted-but-unaccepted candidate; never refresh its target or capture.
    await admitNativeReferences(
      access.referenceFiles,
      scope.ownerId,
      scope.officeSession,
      input.referenceInputs,
    );
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
