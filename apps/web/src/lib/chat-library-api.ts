import { request, unexpectedResponse, ChatApiError, errorMessage } from "./chat-api";
import { chatAttachmentUrl } from "./chat-capability-api";
import { isUuid } from "./chat-validate-base";
import {
  librarySearchParams,
  parseSavedFile,
  parseSavedLibraryPage,
} from "./chat-library-validate";
import type { LibraryQuery, SavedFile, SavedLibraryPage } from "./chat-library-types";

const READ_TIMEOUT_MS = 15_000;

function filesPath(chatId: string, fileId?: string): string {
  if (!isUuid(chatId) || (fileId !== undefined && !isUuid(fileId)))
    throw new Error("Invalid saved file identity.");
  return `/api/chats/${encodeURIComponent(chatId)}/files${fileId ? `/${encodeURIComponent(fileId)}` : ""}`;
}

function readSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Reads only accepted files; pagination/search never depends on loaded messages. */
export async function listSavedFiles(
  chatId: string,
  query: LibraryQuery = {},
  signal?: AbortSignal,
): Promise<SavedLibraryPage> {
  const params = librarySearchParams(query);
  const page = parseSavedLibraryPage(
    await request(`${filesPath(chatId)}?${params}`, {
      signal: readSignal(signal),
      cache: "no-store",
    }),
  );
  if (!page || page.chatId !== chatId || page.nextCursor === query.cursor)
    throw unexpectedResponse();
  return page;
}

export async function getSavedFile(
  chatId: string,
  fileId: string,
  signal?: AbortSignal,
): Promise<SavedFile> {
  const file = parseSavedFile(
    await request(filesPath(chatId, fileId), { signal: readSignal(signal), cache: "no-store" }),
  );
  if (!file || file.chatId !== chatId || file.id !== fileId) throw unexpectedResponse();
  return file;
}

/** Private same-origin original; no descriptor-controlled/public URLs are accepted. */
export function savedOriginalUrl(file: Pick<SavedFile, "chatId" | "id">): string {
  filesPath(file.chatId, file.id);
  return chatAttachmentUrl(file.chatId, file.id);
}

/** A bounded original GET, not a metadata-only claim that missing bytes recovered. */
export async function readSavedOriginal(file: SavedFile, signal?: AbortSignal): Promise<void> {
  const response = await fetch(savedOriginalUrl(file), {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: readSignal(signal),
  });
  if (!response.ok || !response.body) throw new Error("The saved original could not be read.");
  const type = response.headers.get("content-type")?.split(";")[0]?.trim();
  const expected = file.kind === "text" ? "text/plain" : file.mediaType;
  if (type !== expected) {
    await response.body.cancel();
    throw new Error("The saved original has an unexpected format.");
  }
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > file.byteSize) throw new Error("The saved original has unexpected content.");
    }
    if (bytes !== file.byteSize) throw new Error("The saved original was incomplete.");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function libraryReadMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "Reading the saved file timed out. Your draft and saved files are unchanged.";
  if (error instanceof ChatApiError && error.status === 404)
    return "The saved file or list could not be found. Your draft is unchanged.";
  return errorMessage(error);
}
