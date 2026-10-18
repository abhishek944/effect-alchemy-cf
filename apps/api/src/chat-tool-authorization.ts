/**
 * Durable, immutable owner binding for one conversation object.
 *
 * This records *who* the conversation belongs to and nothing else. It is not
 * permission to change account settings: account commands are authorized only by
 * proving the executing tool's own accepted native input and its frozen command
 * (see `chat-account-resolver.ts`). The binding is written from the trusted
 * internal `/messages` route, repeated values must match, and a mismatch fails
 * closed instead of replacing the binding.
 */
import type { AgentContext } from "agents";
import { Schema } from "effect";
import { decodeOption } from "./chat-internal.ts";
import { DomainUuid } from "./chat-capabilities.ts";

const Owner = Schema.Struct({
  ownerId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
});

/** Derives the owner from the server-assigned object name `chat:<owner>:<chatId>`. */
export const conversationOwner = (name: string | undefined): string | null => {
  if (name === undefined || !name.startsWith("chat:")) return null;
  const rest = name.slice("chat:".length);
  const split = rest.lastIndexOf(":");
  if (split <= 0 || split === rest.length - 1) return null;
  const ownerId = rest.slice(0, split);
  const chatId = rest.slice(split + 1);
  if (ownerId.length === 0 || ownerId.length > 256) return null;
  return decodeOption(DomainUuid, chatId) === null ? null : ownerId;
};

export class ChatOwnerBinding {
  private readonly storage: AgentContext["storage"];

  constructor(storage: AgentContext["storage"]) {
    this.storage = storage;
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS chat_owner_binding (
      key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, updated_at INTEGER NOT NULL
    )`);
  }

  /** First writer wins; a later different owner is refused, never replaced. */
  bind(ownerId: string, now: number): boolean {
    if (decodeOption(Owner, { ownerId }) === null) return false;
    const existing = this.owner();
    if (existing !== null) return existing === ownerId;
    this.storage.sql.exec(
      `INSERT INTO chat_owner_binding (key, owner_id, updated_at) VALUES ('owner', ?, ?)
       ON CONFLICT(key) DO NOTHING`,
      ownerId,
      now,
    );
    return this.owner() === ownerId;
  }

  owner(): string | null {
    const row = this.storage.sql
      .exec<{ owner_id: string }>(`SELECT owner_id FROM chat_owner_binding WHERE key = 'owner'`)
      .toArray()[0];
    return row === undefined ? null : row.owner_id;
  }
}
