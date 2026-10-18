import { Schema } from "effect";
import { ChatSelection } from "./chat-capabilities.ts";
import { FileDescriptor } from "./chat-attachment-schema.ts";
import { decodeOption } from "./chat-internal.ts";
import type { ChatSqlStorage } from "./chat-ledger.ts";
import {
  decodeAccountOperation,
  type AccountOperationRecord,
  type AccountOperationView,
} from "./chat-account-operations.ts";

const SendRecord = Schema.Struct({
  selection: ChatSelection,
  textLength: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 16000 })),
  files: Schema.Array(FileDescriptor).check(Schema.isMaxLength(5)),
});
type SendRecord = typeof SendRecord.Type;
export type PublicChatInput = {
  operationId: string;
  files: readonly FileDescriptor[];
  textLength: number | null;
};

/** Immutable per-send metadata; native Pi still owns execution and the transcript. */
export class ChatSendRecords {
  private readonly db: ChatSqlStorage;
  constructor(db: ChatSqlStorage) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS send_inputs (
      operation_id TEXT PRIMARY KEY, identity_hash TEXT NOT NULL, metadata TEXT NOT NULL
    )`);
    // Additive columns; existing rows keep NULL and fail account mutation closed.
    const columns = db
      .exec<{ name: string }>(`SELECT name FROM pragma_table_info('send_inputs')`)
      .toArray()
      .map((row) => row.name);
    for (const column of ["account_owner", "account_chat", "account_intent"]) {
      if (!columns.includes(column)) db.exec(`ALTER TABLE send_inputs ADD COLUMN ${column} TEXT`);
    }
  }

  identity(operationId: string): string | null {
    return (
      this.db
        .exec<{ identity_hash: string }>(
          `SELECT identity_hash FROM send_inputs WHERE operation_id = ?`,
          operationId,
        )
        .toArray()[0]?.identity_hash ?? null
    );
  }

  // The account evidence is written in the same insert as the send record, so a
  // rejected or duplicated delivery can never amend it; a known operation is
  // left exactly as first stored.
  bind(
    operationId: string,
    identityHash: string,
    record: SendRecord,
    account?: AccountOperationRecord,
  ): boolean {
    const known = this.db
      .exec<{ identity_hash: string }>(
        `SELECT identity_hash FROM send_inputs WHERE operation_id = ?`,
        operationId,
      )
      .toArray()[0];
    if (known !== undefined) return known.identity_hash === identityHash;
    this.db.exec(
      `INSERT INTO send_inputs
       (operation_id, identity_hash, metadata, account_owner, account_chat, account_intent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      operationId,
      identityHash,
      JSON.stringify(record),
      account?.ownerId ?? null,
      account?.chatScope ?? null,
      account === undefined ? null : JSON.stringify(account),
    );
    return true;
  }

  /** Frozen host evidence for one operation, or null when none was prepared. */
  account(operationId: string): AccountOperationView | null {
    const row = this.db
      .exec<{ identity_hash: string; account_intent: string | null }>(
        `SELECT identity_hash, account_intent FROM send_inputs WHERE operation_id = ?`,
        operationId,
      )
      .toArray()[0];
    if (row === undefined) return null;
    return decodeAccountOperation(row.account_intent, {
      operationId,
      identityHash: row.identity_hash,
    });
  }

  forEntry(entryId: number): PublicChatInput | null {
    const row = this.db
      .exec<{ operation_id: string; metadata: string | null }>(
        `SELECT o.operation_id, s.metadata FROM operations o
       LEFT JOIN send_inputs s ON s.operation_id = o.operation_id WHERE o.entry_id = ? LIMIT 1`,
        String(entryId),
      )
      .toArray()[0];
    if (row === undefined) return null;
    const parsed: unknown = row.metadata === null ? null : JSON.parse(row.metadata);
    const record = parsed === null ? null : decodeOption(SendRecord, parsed);
    if (parsed !== null && record === null) throw new Error("Invalid stored send metadata");
    return {
      operationId: row.operation_id,
      files: record?.files ?? [],
      textLength: record?.textLength ?? null,
    };
  }
}
