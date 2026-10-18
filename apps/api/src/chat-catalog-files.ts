import type * as cf from "@cloudflare/workers-types";
import type { AgentContext } from "agents";
import { ChatFilesCatalog } from "./chat-files-catalog.ts";
import { handleChatFilesCatalogRequest, receiptProbe } from "./chat-files-catalog-http.ts";
import { copyToRetained, deleteStoredObjects } from "./chat-files-store.ts";
import type { Chat } from "./chat-model.ts";

export type CatalogFilesEnv = {
  CHAT_FILES?: cf.R2Bucket;
  ChatConversation?: cf.DurableObjectNamespace;
};
/** Private owner-scoped storage glue; no browser owner id or raw object key is trusted. */
export class ChatCatalogFiles {
  private readonly owner: () => Promise<string | undefined>;
  private readonly scope: string;
  private readonly env: CatalogFilesEnv;
  private readonly catalog: ChatFilesCatalog;
  private readonly chat: (id: string) => Chat | null;
  constructor(
    ctx: AgentContext,
    env: CatalogFilesEnv,
    chat: (id: string) => Chat | null,
    owner: () => Promise<string | undefined>,
  ) {
    this.owner = owner;
    this.scope = ctx.id.toString();
    this.env = env;
    this.chat = chat;
    this.catalog = new ChatFilesCatalog({ db: ctx.storage.sql, scope: this.scope });
  }

  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/files/")) return null;
    const ownerId = await this.owner();
    const bucket = this.env.CHAT_FILES;
    return handleChatFilesCatalogRequest(this.catalog, request, {
      bucket,
      objects:
        bucket === undefined
          ? undefined
          : {
              delete: (keys) => deleteStoredObjects(bucket, keys),
              copy: (from, to) => copyToRetained(bucket, from, to),
            },
      probeAccepted:
        ownerId === undefined
          ? async () => "unknown"
          : receiptProbe({
              namespace: this.env.ChatConversation,
              ownerId,
              chat: this.chat,
            }),
    });
  }

  async cleanup(): Promise<void> {
    const response = await this.handle(
      new Request("https://chat.internal/files/sweep", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ now: Date.now(), limit: 32 }),
      }),
    );
    if (response === null || !response.ok) throw new Error("Private file cleanup unavailable");
  }
}
