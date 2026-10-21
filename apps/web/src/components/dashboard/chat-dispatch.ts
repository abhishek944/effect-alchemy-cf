import { errorMessage, sendMessage } from "@/lib/chat-api";
import type { ChatFilesControls, SendSnapshot } from "@/lib/chat-store-context";

export type DispatchResult = { ok: true } | { ok: false; error: string };

/**
 * Uploads still-local bytes and submits one frozen operation. Identity is
 * verified before the message request, so a retry after upload failure reuses
 * the same operation and attachment ids and never creates duplicate work.
 */
export async function dispatchSend(
  chatId: string,
  text: string,
  operationId: string,
  frozen: SendSnapshot,
  files: ChatFilesControls,
): Promise<DispatchResult> {
  const upload = await files.ensureUploaded(chatId, frozen.attachments);
  if (!upload.ok) return { ok: false, error: upload.error };
  if (!frozen.attachments.every((id) => upload.ids.includes(id)))
    return { ok: false, error: "The staged files changed before sending. Discard and try again." };
  try {
    const receipt = await sendMessage(chatId, {
      operationId,
      text,
      selection: frozen.selection,
      attachments: frozen.attachments,
      references: frozen.references ?? [],
    });
    return receipt.accepted
      ? { ok: true }
      : {
          ok: false,
          error:
            "Acceptance of this message could not be confirmed. Retry with the same request, or discard it.",
        };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
