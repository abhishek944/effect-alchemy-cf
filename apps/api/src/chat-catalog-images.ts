import type * as cf from "@cloudflare/workers-types";
import type { AgentContext } from "agents";
import type { Chat } from "./chat-model.ts";
import { json } from "./chat-internal.ts";
import { ChatImagePreferencesStore } from "./chat-image-preference-store.ts";
import { imagePreferenceCatalog } from "./chat-image-preference-http.ts";
import { ChatSavedLibrary } from "./chat-library-catalog.ts";
import { handleChatLibraryRequest } from "./chat-library-http.ts";
import { ChatGeneratedStorage } from "./chat-generated-storage.ts";
import { handleChatGeneratedRequest } from "./chat-generated-http.ts";

/** One owner actor shares its real SQL quota, immutable bucket scope and chat authority. */
export class ChatCatalogImages {
  private readonly preferences: ChatImagePreferencesStore;
  private readonly library: ChatSavedLibrary;
  private readonly generated: ChatGeneratedStorage | null;

  constructor(
    ctx: AgentContext,
    bucket: cf.R2Bucket | undefined,
    chat: (id: string) => Chat | null,
  ) {
    const scope = ctx.id.toString();
    this.preferences = new ChatImagePreferencesStore(ctx.storage);
    this.library = new ChatSavedLibrary({
      db: ctx.storage.sql,
      scope,
      ...(bucket === undefined ? {} : { bucket }),
    });
    this.generated =
      bucket === undefined
        ? null
        : new ChatGeneratedStorage({
            storage: ctx.storage,
            bucket,
            scope,
            canGenerate: (id) => chat(id)?.archived === false,
          });
  }

  async handle(request: Request): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    if (path === "/images/preferences") return imagePreferenceCatalog(request, this.preferences);
    if (["/files/library", "/files/saved", "/files/original-metadata"].includes(path))
      return handleChatLibraryRequest(this.library, request);
    if (path.startsWith("/files/generated/")) {
      if (this.generated === null) return json({ ok: false, code: "unavailable" }, 503);
      return handleChatGeneratedRequest(this.generated, request);
    }
    return null;
  }
}
