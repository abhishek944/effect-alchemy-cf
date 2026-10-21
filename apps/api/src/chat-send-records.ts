import { Schema } from "effect";
import type { OfficeSessionBinding } from "@starter/auth/office-session";
import { decodeChatOfficeSession } from "./chat-office-session.ts";
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
export type SendEra = "featured" | "legacy" | "unknown";

export type PublicChatInput = {
  operationId: string;
  /** Logical user command; equals operationId for an original send. */
  logicalOperationId: string | null;
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
    for (const column of [
      "account_owner",
      "account_chat",
      "account_intent",
      "logical_operation_id",
      "office_session",
    ]) {
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

  /**
   * Positive provenance classification, never a missing-state default. A row
   * with no logical-operation column predates the feature; a row with one is
   * featured; no row at all is unknown and must fail closed rather than be
   * mistaken for a pre-feature send.
   */
  sendEra(operationId: string): SendEra {
    const row = this.db
      .exec<{ logical_operation_id: string | null }>(
        `SELECT logical_operation_id FROM send_inputs WHERE operation_id = ?`,
        operationId,
      )
      .toArray()[0];
    if (row === undefined) return "unknown";
    return row.logical_operation_id === null ? "legacy" : "featured";
  }

  /** Frozen selection, file descriptors and exact caption length for one operation. */
  metadata(operationId: string): {
    readonly selection: SendRecord["selection"];
    readonly files: readonly FileDescriptor[];
    readonly textLength: number;
  } | null {
    const row = this.db
      .exec<{ metadata: string | null }>(
        `SELECT metadata FROM send_inputs WHERE operation_id = ?`,
        operationId,
      )
      .toArray()[0];
    if (row === undefined || row.metadata === null) return null;
    const record = decodeOption(SendRecord, JSON.parse(row.metadata));
    if (record === null) throw new Error("Invalid stored send metadata");
    return { selection: record.selection, files: record.files, textLength: record.textLength };
  }

  // The account evidence is written in the same insert as the send record, so a
  // rejected or duplicated delivery can never amend it; a known operation is
  // left exactly as first stored.
  bind(
    operationId: string,
    identityHash: string,
    record: SendRecord,
    account?: AccountOperationRecord,
    logicalOperationId?: string,
    officeSession?: OfficeSessionBinding,
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
       (operation_id, identity_hash, metadata, account_owner, account_chat, account_intent,
        logical_operation_id, office_session)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      operationId,
      identityHash,
      JSON.stringify(record),
      account?.ownerId ?? null,
      account?.chatScope ?? null,
      account === undefined ? null : JSON.stringify(account),
      logicalOperationId ?? operationId,
      officeSession === undefined ? null : JSON.stringify(officeSession),
    );
    return true;
  }

  /** Authoritative logical-operation join for one send record, or null. */
  logicalOperation(operationId: string): string | null {
    const row = this.db
      .exec<{ logical_operation_id: string | null }>(
        `SELECT logical_operation_id FROM send_inputs WHERE operation_id = ?`,
        operationId,
      )
      .toArray()[0];
    return row?.logical_operation_id ?? null;
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

  /** Private original association only; never include it in history/public metadata. */
  officeSession(operationId: string): OfficeSessionBinding | null {
    const row = this.db
      .exec<{ office_session: string | null }>(
        "SELECT office_session FROM send_inputs WHERE operation_id = ?",
        operationId,
      )
      .toArray()[0];
    return decodeChatOfficeSession(row?.office_session ?? null);
  }

  forEntry(entryId: number): PublicChatInput | null {
    const row = this.db
      .exec<{ operation_id: string; logical_operation_id: string | null; metadata: string | null }>(
        `SELECT o.operation_id, s.logical_operation_id, s.metadata FROM operations o
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
      logicalOperationId: row.logical_operation_id ?? row.operation_id,
      files: record?.files ?? [],
      textLength: record?.textLength ?? null,
    };
  }
}
