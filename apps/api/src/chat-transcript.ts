import type { Message } from "@earendil-works/pi-ai";
import { Schema } from "effect";
import type { ChatSqlStorage } from "./chat-ledger.ts";
import { decodeOption } from "./chat-internal.ts";
import { migrateChatTranscript } from "./chat-transcript-migration.ts";
import { transcriptContext } from "./chat-transcript-context.ts";
import {
  EntryRecord,
  ROOT_CONVERSATION_ID,
  type Conversation,
  type EntryCursor,
  type EntryPage,
  type EntryQuery,
  type PiContext,
  type ContextView,
} from "./chat-transcript-types.ts";

export const StoredRun = Schema.Struct({
  operationId: Schema.String,
  entry: Schema.NullOr(Schema.Number),
  runId: Schema.String,
  status: Schema.Literals(["placed", "done", "unanswered", "stopped"]),
});
export type StoredRun = typeof StoredRun.Type;

/** App-owned finalized transcript. This is storage and projection, never an agent runtime. */
export class ChatTranscript implements Conversation {
  readonly id = ROOT_CONVERSATION_ID;
  readonly db: ChatSqlStorage;
  constructor(db: ChatSqlStorage) {
    this.db = db;
    db.exec(
      `CREATE TABLE IF NOT EXISTS chat_sdk_entries (id INTEGER PRIMARY KEY, record TEXT NOT NULL)`,
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS chat_sdk_runs (operation_id TEXT PRIMARY KEY, record TEXT NOT NULL)`,
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS chat_sdk_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
    migrateChatTranscript(db);
    // Process loss is terminal. No SDK work is replayed on a fresh object instance.
    db.exec(
      `UPDATE chat_sdk_runs SET record = json_set(record, '$.status', 'unanswered') WHERE json_extract(record, '$.status') = 'placed'`,
    );
  }
  entry(id: number): EntryRecord | undefined {
    const row = this.db
      .exec<{ record: string }>(`SELECT record FROM chat_sdk_entries WHERE id = ?`, id)
      .toArray()[0];
    if (row === undefined) return undefined;
    const entry = decodeOption(EntryRecord, JSON.parse(row.record));
    if (entry === null) throw new Error("Invalid stored transcript entry");
    return entry;
  }
  append(message: Message, kind?: string, operationId?: string): EntryRecord {
    const id =
      (this.db
        .exec<{ id: number }>(`SELECT COALESCE(MAX(id), 0) AS id FROM chat_sdk_entries`)
        .toArray()[0]?.id ?? 0) + 1;
    const entry: EntryRecord = {
      id,
      conversationId: this.id,
      kind:
        kind ??
        (message.role === "user"
          ? "pi.user"
          : message.role === "assistant"
            ? "pi.assistant"
            : message.role === "toolResult"
              ? "pi.tool-result"
              : "pi.system"),
      model: [message],
      ...(operationId === undefined ? {} : { operationId }),
    };
    this.db.exec(
      `INSERT INTO chat_sdk_entries (id, record) VALUES (?, ?)`,
      id,
      JSON.stringify(entry),
    );
    return entry;
  }
  run(operationId: string): StoredRun | null {
    const row = this.db
      .exec<{ record: string }>(
        `SELECT record FROM chat_sdk_runs WHERE operation_id = ?`,
        operationId,
      )
      .toArray()[0];
    if (row === undefined) return null;
    const run = decodeOption(StoredRun, JSON.parse(row.record));
    if (run === null) throw new Error("Invalid stored run");
    return run;
  }
  saveRun(run: StoredRun): void {
    this.db.exec(
      `INSERT INTO chat_sdk_runs (operation_id, record) VALUES (?, ?) ON CONFLICT(operation_id) DO UPDATE SET record = excluded.record`,
      run.operationId,
      JSON.stringify(run),
    );
  }
  latestRun(): StoredRun | null {
    const row = this.db
      .exec<{ operation_id: string }>(
        `SELECT operation_id FROM chat_sdk_runs ORDER BY rowid DESC LIMIT 1`,
      )
      .toArray()[0];
    return row === undefined ? null : this.run(row.operation_id);
  }
  async entries(
    query: EntryQuery,
    limit: number,
    cursor: EntryCursor | undefined,
    _context: PiContext,
  ): Promise<EntryPage> {
    const ascending = query.order === "ascending";
    const min = query.minEntryId ?? 1;
    const max = query.maxEntryId ?? Number.MAX_SAFE_INTEGER;
    const after = cursor?.after ?? (ascending ? 0 : Number.MAX_SAFE_INTEGER);
    const rows = this.db
      .exec<{ id: number }>(
        `SELECT id FROM chat_sdk_entries WHERE id >= ? AND id <= ? AND id ${ascending ? ">" : "<"} ? ORDER BY id ${ascending ? "ASC" : "DESC"} LIMIT ?`,
        min,
        max,
        after,
        limit + 1,
      )
      .toArray();
    const items = rows.slice(0, limit).map((row) => {
      const entry = this.entry(row.id);
      if (entry === undefined) throw new Error("Transcript entry disappeared");
      return entry;
    });
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > limit && last !== undefined
        ? { next: { after: last.id, order: query.order } }
        : {}),
    };
  }
  async context(_context: PiContext): Promise<ContextView> {
    return this.contextView();
  }
  contextView(): ContextView {
    const ids = this.db
      .exec<{ id: number }>(`SELECT id FROM chat_sdk_entries ORDER BY id`)
      .toArray();
    const entries = ids.map((row) => {
      const entry = this.entry(row.id);
      if (entry === undefined) throw new Error("Transcript entry disappeared");
      return entry;
    });
    return transcriptContext(entries);
  }
}
