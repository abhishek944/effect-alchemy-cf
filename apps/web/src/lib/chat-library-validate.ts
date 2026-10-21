import { parseChatFileDescriptor } from "./chat-capability-file-validate";
import { isRecord, isUuid } from "./chat-validate-base";
import type { LibraryQuery, SavedFile, SavedLibraryPage } from "./chat-library-types";

export function parseSavedFile(value: unknown): SavedFile | null {
  const file = parseChatFileDescriptor(value);
  if (!file || !isRecord(value)) return null;
  if (value.origin !== "upload" && value.origin !== "generated") return null;
  if (file.state !== "ready" && file.state !== "unavailable") return null;
  if (file.expiresAt !== null || !Array.isArray(value.sources)) return null;
  const sources: string[] = [];
  for (const id of value.sources) {
    if (!isUuid(id) || id === file.id) return null;
    sources.push(id);
  }
  let generation: SavedFile["generation"] = null;
  if (value.generation !== null) {
    const info = value.generation;
    if (!isRecord(info) || !isUuid(info.operationId)) return null;
    if (typeof info.callId !== "string" || !info.callId.length || info.callId.length > 256)
      return null;
    for (const character of info.callId) {
      const code = character.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) return null;
    }
    generation = { callId: info.callId, operationId: info.operationId };
  }
  if (value.origin === "upload" && (generation !== null || sources.length !== 0)) return null;
  if (value.origin === "generated" && (generation === null || file.kind !== "image")) return null;
  return { ...file, origin: value.origin, sources, generation };
}

export function parseSavedLibraryPage(value: unknown): SavedLibraryPage | null {
  if (!isRecord(value) || !isUuid(value.chatId) || !Array.isArray(value.files)) return null;
  if (value.files.length > 50) return null;
  if (value.nextCursor !== null && !isLibraryCursor(value.nextCursor)) return null;
  const files: SavedFile[] = [];
  const ids = new Set<string>();
  for (const item of value.files) {
    const file = parseSavedFile(item);
    if (!file || file.chatId !== value.chatId || ids.has(file.id)) return null;
    ids.add(file.id);
    files.push(file);
  }
  return { chatId: value.chatId, files, nextCursor: value.nextCursor };
}

function isLibraryCursor(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048;
}

export function librarySearchParams(query: LibraryQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search !== undefined) {
    if (query.search.length > 120) throw new Error("Search names using at most 120 characters.");
    params.set("search", query.search);
  }
  for (const [key, allowed] of [
    ["kind", ["all", "image", "text"]],
    ["origin", ["all", "upload", "generated"]],
    ["sort", ["newest", "oldest", "name"]],
  ] as const) {
    const value = query[key];
    if (value === undefined) continue;
    if (!allowed.some((option) => option === value)) throw new Error("Invalid file filter.");
    params.set(key, value);
  }
  if (query.cursor !== undefined) {
    if (!isLibraryCursor(query.cursor))
      throw new Error("Invalid file page. Return to the first page.");
    params.set("cursor", query.cursor);
  }
  if (query.limit !== undefined) {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 50)
      throw new Error("Invalid file page size.");
    params.set("limit", String(query.limit));
  }
  return params;
}
