import { requestDecoded } from "./chat-api";
import { isRecord, isUuid } from "./chat-validate-base";
import { parseSavedFile } from "./chat-library-validate";
import type { SavedFile } from "./chat-library-types";

export type AssistantSavedFilesPage = {
  messageId: string;
  files: readonly SavedFile[];
  nextCursor: string | null;
};

function messageIdentity(value: string): boolean {
  if (!/^[1-9][0-9]{0,15}:(0|[1-9][0-9]{0,15})$/.test(value)) return false;
  return value.split(":").every((part) => Number.isSafeInteger(Number(part)));
}

export function parseAssistantSavedFilesPage(
  value: unknown,
  chatId: string,
  messageId: string,
): AssistantSavedFilesPage | null {
  if (
    !isRecord(value) ||
    value.messageId !== messageId ||
    !Array.isArray(value.files) ||
    value.files.length > 30
  )
    return null;
  if (
    value.nextCursor !== null &&
    (typeof value.nextCursor !== "string" ||
      !value.nextCursor.length ||
      value.nextCursor.length > 2048)
  )
    return null;
  const files: SavedFile[] = [];
  const ids = new Set<string>();
  for (const item of value.files) {
    const file = parseSavedFile(item);
    if (!file || file.chatId !== chatId || file.origin !== "generated" || ids.has(file.id))
      return null;
    ids.add(file.id);
    files.push(file);
  }
  return { messageId, files, nextCursor: value.nextCursor };
}

/** Exact native assistant entry/model-slot receipts, separate from transcript frames. */
export async function getAssistantSavedFiles(
  chatId: string,
  messageId: string,
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<AssistantSavedFilesPage> {
  if (!isUuid(chatId) || !messageIdentity(messageId))
    throw new Error("Invalid saved response identity.");
  if (cursor !== null && (!cursor.length || cursor.length > 2048))
    throw new Error("Invalid saved-file page.");
  const params = cursor === null ? "" : `?${new URLSearchParams({ cursor })}`;
  const timeout = AbortSignal.timeout(15_000);
  return requestDecoded(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/files${params}`,
    "chat.assistant-files",
    (body) => {
      const page = parseAssistantSavedFilesPage(body, chatId, messageId);
      return page && (page.nextCursor === null || page.nextCursor !== cursor) ? page : null;
    },
    { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: "no-store" },
  );
}
