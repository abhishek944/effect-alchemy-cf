/**
 * T27 bounded read queries. Lifetime views are SQL aggregates (SUM/COUNT
 * grouped by model or speech unit, at most catalog-group cardinality) and the
 * recent attempt window is a bounded LIMIT with one indexed task-id lookup, so
 * a usage read never loads the full historical ledger into JavaScript.
 */
import type { ChatSqlStorage } from "./chat-ledger.ts";
import {
  ATTEMPT_COLUMNS,
  ATTEMPT_GROUP_COLUMNS,
  attemptRow,
  lifetimeGroup,
  speechGroup,
  type AttemptGroupRow,
  type AttemptRow,
  type LifetimeGroup,
  type RecentAttempt,
  type SpeechGroup,
  type SpeechGroupRow,
} from "./chat-accounting-rows.ts";

/** Everything the lifetime projection needs, already grouped and bounded. */
export type Lifetime = {
  readonly attempts: readonly LifetimeGroup[];
  readonly titles: readonly LifetimeGroup[];
  readonly speech: readonly SpeechGroup[];
};

const groupRows = (db: ChatSqlStorage, where: string): LifetimeGroup[] =>
  db
    .exec<AttemptGroupRow>(
      `SELECT ${ATTEMPT_GROUP_COLUMNS} FROM accounting_attempts WHERE ${where} GROUP BY model`,
    )
    .toArray()
    .map(lifetimeGroup);

const speechRows = (db: ChatSqlStorage): SpeechGroup[] =>
  db
    .exec<SpeechGroupRow>(
      `SELECT unit, SUM(quantity) AS quantity, SUM(estimated_cost_usd) AS cost, COUNT(*) AS rows,
              SUM(CASE WHEN completeness = 'unknown' THEN 1 ELSE 0 END) AS unknown_rows,
              SUM(CASE WHEN completeness = 'complete' THEN 1 ELSE 0 END) AS complete_rows,
              SUM(CASE WHEN estimated_cost_usd IS NULL THEN 1 ELSE 0 END) AS missing_cost_rows
       FROM accounting_speech GROUP BY unit`,
    )
    .toArray()
    .flatMap((row) => {
      const group = speechGroup(row);
      return group === null ? [] : [group];
    });

export const readLifetime = (db: ChatSqlStorage): Lifetime => ({
  attempts: groupRows(db, "kind != 'title'"),
  titles: groupRows(db, "kind = 'title'"),
  speech: speechRows(db),
});

const TASK_ID_CHUNK = 90;

const latestTaskRowids = (db: ChatSqlStorage, taskIds: readonly string[]): Map<string, number> => {
  const last = new Map<string, number>();
  for (let index = 0; index < taskIds.length; index += TASK_ID_CHUNK) {
    const chunk = taskIds.slice(index, index + TASK_ID_CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db
      .exec<{ task_id: string; last_rowid: number }>(
        `SELECT task_id, MAX(rowid) AS last_rowid FROM accounting_attempts
         WHERE kind = 'generation' AND task_id IN (${placeholders}) GROUP BY task_id`,
        ...chunk,
      )
      .toArray();
    for (const row of rows) last.set(row.task_id, row.last_rowid);
  }
  return last;
};

/** Newest `limit` attempts, chronological, with retry classification. */
export const readRecentAttempts = (db: ChatSqlStorage, limit: number): readonly RecentAttempt[] => {
  const rows = db
    .exec<AttemptRow>(
      `SELECT rowid, ${ATTEMPT_COLUMNS} FROM accounting_attempts
       ORDER BY recorded_at DESC, rowid DESC LIMIT ?`,
      limit,
    )
    .toArray();
  const taskIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.kind === "generation" && row.task_id !== null ? [row.task_id] : [],
      ),
    ),
  ];
  const last = latestTaskRowids(db, taskIds);
  return rows
    .flatMap((row) => {
      const attempt = attemptRow(row);
      if (attempt === null) return [];
      const retried =
        attempt.kind === "generation" &&
        attempt.stopReason === "error" &&
        attempt.taskId !== null &&
        (last.get(attempt.taskId) ?? row.rowid) > row.rowid;
      return [{ attempt, retried }];
    })
    .toReversed();
};
