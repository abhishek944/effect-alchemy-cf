import { Schema } from "effect";
import { DomainUuid } from "./chat-capabilities.ts";
import { decodeOption, json } from "./chat-internal.ts";
import { LibraryQuery } from "./chat-library-schema.ts";
import { ImageStorageError } from "./chat-image-storage-schema.ts";
import type { ChatSavedLibrary } from "./chat-library-catalog.ts";

const List = Schema.Struct({ chatId: DomainUuid, ...LibraryQuery.fields });
const Get = Schema.Struct({ chatId: DomainUuid, fileId: DomainUuid });
/** Private owner routes. Parent authorizes owner/chat before exposing bare public DTOs. */
export const handleChatLibraryRequest = async (
  library: ChatSavedLibrary,
  request: Request,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    !["/files/library", "/files/saved", "/files/original-metadata"].includes(url.pathname)
  )
    return null;
  try {
    const raw = Object.fromEntries(url.searchParams);
    if (url.pathname === "/files/original-metadata") {
      const query = decodeOption(Get, raw);
      if (query === null) return json({ ok: false, code: "invalid_input" }, 400);
      const original = library.original(query.chatId, query.fileId);
      return original === null
        ? json({ ok: false, code: "not_found" }, 404)
        : json({ ok: true, value: original });
    }
    if (url.pathname === "/files/saved") {
      const query = decodeOption(Get, raw);
      if (query === null) return json({ ok: false, code: "invalid_input" }, 400);
      const file = await library.get(query.chatId, query.fileId);
      return file === null
        ? json({ ok: false, code: "not_found" }, 404)
        : json({ ok: true, value: file });
    }
    const query = decodeOption(List, {
      ...raw,
      ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
    });
    if (query === null) return json({ ok: false, code: "invalid_input" }, 400);
    return json({ ok: true, value: await library.list(query.chatId, query) });
  } catch (error) {
    const invalid = error instanceof ImageStorageError && error.code === "invalid_input";
    return json(
      { ok: false, code: invalid ? "invalid_input" : "unavailable" },
      invalid ? 400 : 503,
    );
  }
};
