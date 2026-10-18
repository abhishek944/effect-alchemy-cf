/**
 * Durable T27 ledger over one conversation object's SQLite storage. Writes are
 * monotonic upserts on durable actual-response keys, so replayed observers and
 * claim-then-report flows count exactly once and can only move Unknown toward
 * reported. Reads are bounded SQL aggregates plus a LIMIT window (see
 * chat-accounting-reads.ts), never a full ledger load.
 */
import type { NewAccountingAttempt } from "./chat-accounting-model.ts";
import { readLifetime, readRecentAttempts, type Lifetime } from "./chat-accounting-reads.ts";
import type { RecentAttempt } from "./chat-accounting-rows.ts";
import type { ChatSqlStorage } from "./chat-ledger.ts";
import type { SpeechUsage } from "./chat-usage-schema.ts";

const UPGRADE_ATTEMPT = `(provenance = 'unknown' AND excluded.provenance != 'unknown')
  OR (completeness != 'complete' AND excluded.completeness = 'complete')`;
const UPGRADE_SPEECH = `(provenance = 'unknown' AND excluded.provenance != 'unknown')
  OR (completeness != 'complete' AND excluded.completeness = 'complete')`;

export class ChatAccountingStore {
  private readonly db: ChatSqlStorage;

  constructor(db: ChatSqlStorage) {
    this.db = db;
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS accounting_attempts (
        attempt_key TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, kind TEXT NOT NULL,
        task_id TEXT, stop_reason TEXT, model TEXT, effort TEXT,
        tokens_uncached INTEGER, tokens_output INTEGER, tokens_cache_read INTEGER,
        tokens_cache_write INTEGER, tokens_reasoning INTEGER,
        estimated_cost_usd REAL, provenance TEXT NOT NULL, completeness TEXT NOT NULL,
        recorded_at INTEGER NOT NULL
      )`,
    );
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS accounting_speech (
        operation_id TEXT PRIMARY KEY, chat_id TEXT, kind TEXT NOT NULL, model TEXT NOT NULL,
        voice TEXT, unit TEXT NOT NULL, quantity REAL, estimated_cost_usd REAL,
        provenance TEXT NOT NULL, completeness TEXT NOT NULL, recorded_at INTEGER NOT NULL
      )`,
    );
    // Bounded recent reads order by recorded_at DESC, rowid DESC; the implicit
    // rowid suffix lets one index serve that reverse scan. The retry lookup
    // filters and groups by task_id and takes MAX(rowid), which the second
    // index serves per task. No other indexes are needed by these queries.
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS accounting_attempts_recorded
        ON accounting_attempts (recorded_at)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS accounting_attempts_task
        ON accounting_attempts (task_id)`,
    );
  }

  /** Idempotent actual-response write; a known report upgrades an Unknown claim. */
  record(attempt: NewAccountingAttempt): void {
    const counters = attempt.amount.counters;
    this.db.exec(
      `INSERT INTO accounting_attempts (
        attempt_key, attempt_id, kind, task_id, stop_reason, model, effort,
        tokens_uncached, tokens_output, tokens_cache_read, tokens_cache_write,
        tokens_reasoning, estimated_cost_usd, provenance, completeness, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(attempt_key) DO UPDATE SET
        tokens_uncached = excluded.tokens_uncached, tokens_output = excluded.tokens_output,
        tokens_cache_read = excluded.tokens_cache_read, tokens_cache_write = excluded.tokens_cache_write,
        tokens_reasoning = excluded.tokens_reasoning, estimated_cost_usd = excluded.estimated_cost_usd,
        provenance = excluded.provenance, completeness = excluded.completeness,
        stop_reason = excluded.stop_reason, model = excluded.model, effort = excluded.effort
      WHERE ${UPGRADE_ATTEMPT}`,
      attempt.attemptKey,
      crypto.randomUUID(),
      attempt.kind,
      attempt.taskId,
      attempt.stopReason,
      attempt.model,
      attempt.effort,
      counters?.inputUncached ?? null,
      counters?.output ?? null,
      counters?.cacheRead ?? null,
      counters?.cacheWrite ?? null,
      counters?.reasoning ?? null,
      attempt.amount.estimatedCostUsd,
      attempt.amount.provenance,
      attempt.amount.completeness,
      attempt.recordedAt,
    );
  }

  /** Idempotent per-chat speech write; keyed by the speech operation id. */
  recordSpeech(speech: SpeechUsage, recordedAt: number): void {
    this.db.exec(
      `INSERT INTO accounting_speech (
        operation_id, chat_id, kind, model, voice, unit, quantity,
        estimated_cost_usd, provenance, completeness, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(operation_id) DO UPDATE SET
        quantity = excluded.quantity, estimated_cost_usd = excluded.estimated_cost_usd,
        provenance = excluded.provenance, completeness = excluded.completeness,
        kind = excluded.kind, model = excluded.model, voice = excluded.voice, unit = excluded.unit
      WHERE ${UPGRADE_SPEECH}`,
      speech.operationId,
      speech.chatId,
      speech.kind,
      speech.model,
      speech.voice,
      speech.unit,
      speech.quantity,
      speech.estimatedCostUsd,
      speech.provenance,
      speech.completeness,
      recordedAt,
    );
  }

  /** Bounded lifetime groups for the usage projection. */
  lifetime(): Lifetime {
    return readLifetime(this.db);
  }

  /** Bounded newest window with retry classification. */
  recentAttempts(limit: number): readonly RecentAttempt[] {
    return readRecentAttempts(this.db, limit);
  }
}
