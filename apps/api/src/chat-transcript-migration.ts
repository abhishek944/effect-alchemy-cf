import type { ChatSqlStorage } from "./chat-ledger.ts";

/** One-way data import only. Old tasks are never loaded, resumed or executed. */
export const migrateChatTranscript = (db: ChatSqlStorage): void => {
  const done = db
    .exec<{ value: string }>(`SELECT value FROM chat_sdk_metadata WHERE key = 'legacy-import'`)
    .toArray()[0];
  if (done !== undefined) return;
  const tables = new Set(
    db
      .exec<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .toArray()
      .map((row) => row.name),
  );
  if (tables.has("pi_entries")) {
    db.exec(
      `INSERT OR IGNORE INTO chat_sdk_entries (id, record) SELECT id, record FROM pi_entries WHERE conversation_id = 1`,
    );
  }
  if (tables.has("pi_submissions")) {
    db.exec(`INSERT OR IGNORE INTO chat_sdk_runs (operation_id, record)
      SELECT json_extract(record, '$.requestId'), json_object(
        'operationId', json_extract(record, '$.requestId'),
        'entry', json_extract(record, '$.entry'),
        'runId', 'imported:' || id,
        'status', CASE WHEN EXISTS (SELECT 1 FROM operations WHERE operations.operation_id = json_extract(pi_submissions.record, '$.requestId') AND operations.status = 'stopped') THEN 'stopped' WHEN status = 'done' THEN 'done' ELSE 'unanswered' END)
      FROM pi_submissions WHERE conversation_id = 1 AND json_type(record, '$.requestId') = 'text'
      AND json_extract(record, '$.type') = 'input' ORDER BY id`);
  }
  db.exec(`INSERT INTO chat_sdk_metadata (key, value) VALUES ('legacy-import', '1')`);
};
