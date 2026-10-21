import type { Message } from "@earendil-works/pi-ai";
import { UserEntry, type ContextView } from "@earendil-works/pi-durable";
import type { PlacedImageInput } from "./chat-image-request-accepted.ts";
import { requireImageAccess } from "./chat-image-request-accepted.ts";
import type {
  ImageNativeContext,
  ImageRequestAccess,
  LegacyNativeInput,
} from "./chat-image-request-types.ts";
import { imageProofFailure, sameImageRequestValue } from "./chat-image-request-values.ts";

/** Legacy text can continue; inline image/binary conversion is deliberately NOT inferred. */
export const assertLegacyTextMessages = (messages: readonly Message[]): void => {
  for (const message of messages)
    if (Array.isArray(message.content) && message.content.some((block) => block.type === "image"))
      imageProofFailure();
};

export const resolveLegacyImageInput = (
  access: ImageRequestAccess,
  native: PlacedImageInput,
  context: ImageNativeContext,
): LegacyNativeInput => {
  requireImageAccess(access, context);
  const throughEntryId = access.legacyEra?.boundary(access);
  const entry = native.entry;
  const message = entry.model?.[0];
  if (
    throughEntryId === null ||
    throughEntryId === undefined ||
    entry.id > throughEntryId ||
    access.responses.read(native.operationId) !== null ||
    access.responses.forEntry(String(entry.conversationId), entry.id, 0) !== null ||
    access.responses.isImageEra(String(entry.conversationId), entry.id) ||
    message?.role !== "user" ||
    (Array.isArray(message.content) && message.content.some((block) => block.type !== "text"))
  )
    return imageProofFailure();
  return {
    operationId: native.operationId,
    submissionId: native.submissionId,
    conversationId: native.conversationId,
    entryId: entry.id,
    modelIndex: 0,
    ownerId: access.ownerId,
    chatId: access.chatId,
    chatScope: access.chatScope,
    throughEntryId,
  };
};

/** Real kinds/contributions and visibility, not caption/time/filename or a guessed era. */
export const verifyLegacyRequestView = async (
  access: ImageRequestAccess,
  view: ContextView,
  context: ImageNativeContext,
): Promise<readonly []> => {
  requireImageAccess(access, context);
  assertLegacyTextMessages(view.messages);
  if (view.entries.length !== view.contributions.length) imageProofFailure();
  const messages = new Set(view.messages);
  for (let index = 0; index < view.entries.length; index++) {
    const entry = view.entries[index];
    if (!UserEntry.is(entry)) continue; // Actual text summary/reset kinds grant no attachment authority.
    if (
      entry.conversationId !== access.conversationId ||
      !access.legacyEra?.allows(access, entry.id) ||
      access.responses.forEntry(String(entry.conversationId), entry.id, 0) !== null ||
      access.responses.isImageEra(String(entry.conversationId), entry.id)
    )
      imageProofFailure();
    const visible = await access.storage.entry(access.conversationId, entry.id, context);
    const raw = entry.model?.[0];
    const contribution = view.contributions[index];
    if (
      visible === undefined ||
      !sameImageRequestValue(visible.entry, entry) ||
      entry.model?.length !== 1 ||
      raw?.role !== "user" ||
      (Array.isArray(raw.content) && raw.content.some((block) => block.type !== "text")) ||
      contribution?.length !== 1 ||
      contribution[0] !== raw ||
      !messages.has(raw)
    )
      imageProofFailure();
    requireImageAccess(access, context);
  }
  return [];
};
