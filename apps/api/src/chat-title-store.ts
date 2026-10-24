import type { Ai } from "@cloudflare/workers-types";
import type { ChatSelection } from "./chat-capabilities.ts";
import type { TitleResponse } from "./chat-accounting-model.ts";
import { digestText } from "./chat-internal.ts";
import type { ChatSqlStorage } from "./chat-ledger.ts";
import {
  excerptTitle,
  makeChatTitleNamer,
  reportTitleFailure,
  type ChatTitleNamer,
} from "./chat-title.ts";

export type ChatTitleEnv = { AI?: Ai; CHAT_GATEWAY_ID?: string };

type ChatStamp = { readonly updatedAt: string };

type Options = {
  readonly db: ChatSqlStorage;
  readonly env: ChatTitleEnv;
  readonly waitUntil: (task: Promise<unknown>) => void;
  readonly chat: (id: string) => ChatStamp | null;
  readonly nextUpdatedAt: (previous: string) => string;
  readonly recordUsage: (
    chatId: string,
    operationId: string,
    selection: ChatSelection,
    message: TitleResponse | null,
  ) => Promise<void>;
};

const ensureSchema = (db: ChatSqlStorage): void => {
  const columns = new Set(
    db
      .exec<{ name: string }>(`PRAGMA table_info(chats)`)
      .toArray()
      .map((row) => row.name),
  );
  // Existing rows become explicitly ineligible; new chats are inserted eligible.
  if (!columns.has("title_state")) {
    db.exec(`ALTER TABLE chats ADD COLUMN title_state TEXT NOT NULL DEFAULT 'ineligible'`);
  }
  if (!columns.has("title_claim")) {
    db.exec(`ALTER TABLE chats ADD COLUMN title_claim TEXT`);
  }
};

const operationHash = (db: ChatSqlStorage, chatId: string, operationId: string): string | null =>
  db
    .exec<{ text_hash: string }>(
      `SELECT text_hash FROM operations WHERE operation_id = ? AND chat_id = ?`,
      operationId,
      chatId,
    )
    .toArray()[0]?.text_hash ?? null;

const claimRow = (
  db: ChatSqlStorage,
  chatId: string,
  operationId: string,
  title: string,
  at: string,
): boolean =>
  db.exec(
    `UPDATE chats SET title = ?, title_state = 'pending', title_claim = ?, updated_at = ?
     WHERE id = ? AND title_state = 'eligible' AND title = 'New chat'`,
    title,
    operationId,
    at,
    chatId,
  ).rowsWritten > 0;

const applyGenerated = (
  db: ChatSqlStorage,
  chatId: string,
  operationId: string,
  title: string,
  excerpt: string,
  at: string,
): boolean =>
  db.exec(
    `UPDATE chats SET title = ?, title_state = 'done', updated_at = ?
     WHERE id = ? AND title_state = 'pending' AND title_claim = ? AND title = ?`,
    title,
    at,
    chatId,
    operationId,
    excerpt,
  ).rowsWritten > 0;

const settleFailed = (db: ChatSqlStorage, chatId: string, operationId: string): void => {
  db.exec(
    `UPDATE chats SET title_state = 'failed'
     WHERE id = ? AND title_state = 'pending' AND title_claim = ?`,
    chatId,
    operationId,
  );
};

const writeManual = (db: ChatSqlStorage, chatId: string, title: string, at: string): void => {
  db.exec(
    `UPDATE chats SET title = ?, title_state = 'manual', updated_at = ? WHERE id = ?`,
    title,
    at,
    chatId,
  );
};

/**
 * Catalog-owned naming provenance: explicit eligibility, an atomic one-shot
 * claim with the immediate excerpt, manual precedence, and one background
 * same-model attempt after the claim. A lost dispatch keeps the excerpt.
 */
export class ChatTitles {
  private readonly db: ChatSqlStorage;
  private readonly options: Options;
  private readonly namer: ChatTitleNamer | null;

  constructor(options: Options) {
    this.options = options;
    this.db = options.db;
    ensureSchema(this.db);
    try {
      this.namer = makeChatTitleNamer(options.env.AI, options.env.CHAT_GATEWAY_ID);
    } catch (error) {
      reportTitleFailure(error, "title.setup", "title_namer_unavailable");
      this.namer = null;
    }
  }

  /** Consumes the claim only for the verified first accepted operation text. */
  async claim(
    operationId: string,
    chatId: string,
    text: string,
    identity: string,
    selection: ChatSelection,
  ): Promise<boolean> {
    const hash = await digestText(identity);
    const chat = this.options.chat(chatId);
    if (chat === null || operationHash(this.db, chatId, operationId) !== hash) return false;
    const excerpt = excerptTitle(text);
    const at = this.options.nextUpdatedAt(chat.updatedAt);
    if (!claimRow(this.db, chatId, operationId, excerpt, at)) return false;
    this.options.waitUntil(
      this.name(chatId, operationId, text, excerpt, selection).catch((error) =>
        reportTitleFailure(error, "title.persist", "title_persist_failed", {
          chatId,
          operationId,
        }),
      ),
    );
    return true;
  }

  /** Any manual name wins, including a rename back to "New chat". */
  manual(chatId: string, title: string, at: string): void {
    writeManual(this.db, chatId, title, at);
  }

  private async name(
    chatId: string,
    operationId: string,
    text: string,
    excerpt: string,
    selection: ChatSelection,
  ): Promise<void> {
    let title: string | null = null;
    try {
      title =
        this.namer === null
          ? null
          : await this.namer(text, selection, (message, effective) =>
              this.options.recordUsage(chatId, operationId, effective, message),
            );
    } catch (error) {
      reportTitleFailure(error, "title.generate", "title_generation_failed", {
        chatId,
        operationId,
      });
      title = null;
    }
    const chat = this.options.chat(chatId);
    if (chat === null) return;
    if (title === null) {
      settleFailed(this.db, chatId, operationId);
      return;
    }
    applyGenerated(
      this.db,
      chatId,
      operationId,
      title,
      excerpt,
      this.options.nextUpdatedAt(chat.updatedAt),
    );
  }
}
