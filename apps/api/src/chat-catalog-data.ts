import type { AgentContext } from "agents";
import { Schema } from "effect";
import type { ChatSqlStorage } from "./chat-ledger.ts";
import type { Chat } from "./chat-model.ts";
import type { ChatPreferencesStore } from "./chat-preferences-store.ts";
import type { ChatTitles } from "./chat-title-store.ts";
import {
  CatalogCreateBody,
  CatalogPatchBody,
  CatalogTouchBody,
  decodeOption,
  json,
  requestBody,
} from "./chat-internal.ts";

const Owner = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
});
const OWNER_KEY = "chat:owner";

type ChatRow = {
  id: string;
  title: string;
  archived: number;
  created_at: string;
  updated_at: string;
};
const toChat = (row: ChatRow): Chat => ({
  id: row.id,
  title: row.title,
  archived: row.archived === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const catalogChat = (db: ChatSqlStorage, id: string): Chat | null => {
  const row = db.exec<ChatRow>(`SELECT * FROM chats WHERE id = ?`, id).toArray()[0];
  return row === undefined ? null : toChat(row);
};

/** Owner metadata transactions, separate from paid admission and native execution. */
export class ChatCatalogData {
  private readonly storage: AgentContext["storage"];
  private readonly preferences: ChatPreferencesStore;
  constructor(storage: AgentContext["storage"], preferences: ChatPreferencesStore) {
    this.storage = storage;
    this.preferences = preferences;
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, archived INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
  }

  /** Set only by a namespace-selected, authenticated API caller. */
  async bindOwner(id: string): Promise<boolean> {
    if (decodeOption(Owner, { id }) === null) return false;
    const previous = await this.ownerId();
    if (previous !== undefined) return previous === id;
    await this.storage.put(OWNER_KEY, id);
    return true;
  }

  ownerId(): Promise<string | undefined> {
    return this.storage.get<string>(OWNER_KEY);
  }

  find(id: string): Chat | null {
    return catalogChat(this.storage.sql, id);
  }

  nextUpdatedAt(previous: string): string {
    const parsed = Date.parse(previous);
    return new Date(
      Math.max(Date.now(), (Number.isFinite(parsed) ? parsed : Date.now()) + 1),
    ).toISOString();
  }

  async handle(request: Request, titles: ChatTitles): Promise<Response | null> {
    const url = new URL(request.url);
    const db = this.storage.sql;
    switch (`${request.method} ${url.pathname}`) {
      case "POST /owner": {
        const body = decodeOption(Owner, await requestBody(request));
        if (body === null || !(await this.bindOwner(body.id)))
          return json({ message: "Invalid owner" }, 400);
        return json({ ok: true });
      }
      case "GET /list":
        return json({
          chats: db
            .exec<ChatRow>(`SELECT * FROM chats ORDER BY updated_at DESC, created_at DESC`)
            .toArray()
            .map(toChat),
        });
      case "GET /get": {
        const chat = this.find(url.searchParams.get("id") ?? "");
        return chat === null ? json({ message: "Not found" }, 404) : json(chat);
      }
      case "POST /create": {
        const body = decodeOption(CatalogCreateBody, await requestBody(request));
        if (body === null) return json({ message: "Invalid request" }, 400);
        this.storage.transactionSync(() => {
          const created = this.find(body.id) === null;
          db.exec(
            `INSERT OR IGNORE INTO chats
            (id, title, archived, created_at, updated_at, title_state)
            VALUES (?, 'New chat', 0, ?, ?, 'eligible')`,
            body.id,
            body.now,
            body.now,
          );
          if (created) this.preferences.initializeChat(body.id);
        });
        const chat = this.find(body.id);
        return chat === null ? json({ message: "Create failed" }, 503) : json(chat);
      }
      case "PATCH /patch": {
        const body = decodeOption(CatalogPatchBody, await requestBody(request));
        if (body === null) return json({ message: "Invalid request" }, 400);
        const existing = this.find(body.id);
        if (existing === null) return json({ message: "Not found" }, 404);
        const now = this.nextUpdatedAt(existing.updatedAt);
        if (body.title !== undefined) titles.manual(body.id, body.title, now);
        if (body.archived !== undefined)
          db.exec(
            `UPDATE chats SET archived = ?, updated_at = ? WHERE id = ?`,
            body.archived ? 1 : 0,
            now,
            body.id,
          );
        return json(this.find(body.id));
      }
      case "POST /touch": {
        const body = decodeOption(CatalogTouchBody, await requestBody(request));
        if (body === null) return json({ message: "Invalid request" }, 400);
        const existing = this.find(body.id);
        if (existing === null) return json({ message: "Not found" }, 404);
        db.exec(
          `UPDATE chats SET updated_at = ? WHERE id = ?`,
          this.nextUpdatedAt(existing.updatedAt),
          body.id,
        );
        return json({ ok: true });
      }
      default:
        return null;
    }
  }
}
