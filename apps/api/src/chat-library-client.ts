import type * as cf from "@cloudflare/workers-types";
import { generatedCatalogRequest } from "./chat-generated-client.ts";
import { type LibraryQuery, SavedFile, SavedLibraryPage } from "./chat-library-schema.ts";
import { SavedOriginalMetadata } from "./chat-library-original.ts";
import { ImageStorageError } from "./chat-image-storage-schema.ts";

/** Server-only client. Public parent routes unwrap the safe DTO after owner/chat authorization. */
export const createChatLibraryClient = (stub: cf.DurableObjectStub) => ({
  list: (chatId: string, query: LibraryQuery = {}): Promise<SavedLibraryPage> => {
    const params = new URLSearchParams({ chatId });
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) params.set(key, String(value));
    return generatedCatalogRequest(
      stub,
      `/files/library?${params.toString()}`,
      { method: "GET" },
      SavedLibraryPage,
    );
  },
  original: (chatId: string, fileId: string): Promise<SavedOriginalMetadata | null> =>
    generatedCatalogRequest(
      stub,
      `/files/original-metadata?${new URLSearchParams({ chatId, fileId }).toString()}`,
      { method: "GET" },
      SavedOriginalMetadata,
    ).catch((error: unknown) => {
      if (error instanceof ImageStorageError && error.code === "not_found") return null;
      throw error;
    }),
  get: (chatId: string, fileId: string): Promise<SavedFile> =>
    generatedCatalogRequest(
      stub,
      `/files/saved?${new URLSearchParams({ chatId, fileId }).toString()}`,
      { method: "GET" },
      SavedFile,
    ),
});
