import type * as cf from "@cloudflare/workers-types";
import type { ChatImageCallStore } from "./chat-image-call-store.ts";
import { ImageCallError } from "./chat-image-call-values.ts";
import { ImageStorageError } from "./chat-image-storage-schema.ts";
import { json } from "./chat-internal.ts";
import { createChatLibraryClient } from "./chat-library-client.ts";
import type { SavedFile } from "./chat-library-schema.ts";
import type { Chat } from "./chat-model.ts";
import type { ChatRuntime } from "./chat-runtime.ts";
import { committedId, publicRole } from "./chat-text.ts";

const immutableFile = (file: SavedFile): string => {
  const { state: _state, ...identity } = file;
  return JSON.stringify(identity);
};

/** Owner-authorized private actor reads; no native tool or original byte dispatch. */
export const readConversationImages = async (input: {
  readonly request: Request;
  readonly chat: Chat;
  readonly runtime: ChatRuntime;
  readonly calls: ChatImageCallStore;
  readonly catalog: () => cf.DurableObjectStub;
}): Promise<Response | null> => {
  const url = new URL(input.request.url);
  if (
    input.request.method !== "GET" ||
    (url.pathname !== "/image-files" && url.pathname !== "/image-usage")
  )
    return null;
  try {
    const messageId = url.searchParams.get("messageId");
    if (messageId !== null) {
      const position = committedId(messageId);
      if (position === null) return json({ message: "Invalid message identity" }, 400);
      const entry = await input.runtime.entryFor(position.entry);
      if (
        entry === undefined ||
        entry.id !== position.entry ||
        publicRole(entry) !== "assistant" ||
        entry.model?.[position.index]?.role !== "assistant"
      )
        return json({ message: "Message not found" }, 404);
    }
    if (url.pathname === "/image-usage") return json(input.calls.usage(messageId ?? undefined));
    if (messageId === null) return json({ message: "Missing message identity" }, 400);
    const page = input.calls.assistantFiles(messageId, url.searchParams.get("cursor") ?? undefined);
    if (page.files.length === 0) return json(page);
    const client = createChatLibraryClient(input.catalog());
    const files: SavedFile[] = [];
    for (const saved of page.files) {
      if (saved.chatId !== input.chat.id) throw new ImageCallError("corrupt");
      try {
        const current = await client.get(input.chat.id, saved.id);
        if (immutableFile(current) !== immutableFile(saved)) throw new ImageCallError("corrupt");
        files.push(current);
      } catch (error) {
        if (!(error instanceof ImageStorageError) || error.code !== "not_found") throw error;
        // Preserve exact receipt identity if original metadata disappeared; never regenerate.
        files.push({ ...saved, state: "unavailable" });
      }
    }
    return json({ ...page, files });
  } catch (error) {
    if (error instanceof ImageCallError && error.code === "invalid_input")
      return json({ message: "Invalid image read query or cursor" }, 400);
    return json({ message: "Image records are temporarily unavailable" }, 503);
  }
};
