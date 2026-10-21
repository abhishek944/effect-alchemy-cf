import type { ChatSqlStorage } from "./chat-ledger.ts";
import {
  MAX_ACTIVE_TEXT_BYTES,
  textDigest,
  type SkillActiveEntry as ActiveEntry,
} from "./chat-skills-document.ts";
import {
  decodeAttemptRow,
  type SkillAttemptDbRow,
  type SkillAttemptRow,
  type SkillAttemptStatus,
} from "./chat-skills-store-row.ts";
import type { SkillManifest } from "./skills-model.ts";
export { SkillAttemptStatus, type SkillAttemptRow } from "./chat-skills-store-row.ts";
export type SkillInsertOutcome = "inserted" | "existing" | "conflict";
export type SkillInsertInput = {
  attemptId: string;
  operationId: string;
  logicalOperationId: string;
  retryOf: string | null;
  retryKey: string | null;
  pin: SkillManifest;
  catalog: string;
  catalogDigest: string;
  active: readonly ActiveEntry[];
  content: string;
  now: number;
};
export class ChatSkillsStore {
  private readonly db: ChatSqlStorage;
  constructor(db: ChatSqlStorage) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS skill_attempts (
      attempt_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL,
      logical_operation_id TEXT NOT NULL, retry_of TEXT, retry_key TEXT, pin TEXT,
      status TEXT NOT NULL, failure TEXT, catalog TEXT, catalog_digest TEXT, active TEXT,
      content TEXT, classification TEXT, recoverable INTEGER, recovery_reason TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    const columns = db
      .exec<{ name: string }>(`SELECT name FROM pragma_table_info('skill_attempts')`)
      .toArray()
      .map((row) => row.name);
    const additive = {
      catalog_digest: "TEXT",
      recoverable: "INTEGER",
      recovery_reason: "TEXT",
    } as const;
    for (const [column, type] of Object.entries(additive)) {
      if (!columns.includes(column))
        db.exec(`ALTER TABLE skill_attempts ADD COLUMN ${column} ${type}`);
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS skill_attempt_operation ON skill_attempts(operation_id);
      CREATE UNIQUE INDEX IF NOT EXISTS skill_attempt_retry
      ON skill_attempts(logical_operation_id, retry_key) WHERE retry_key IS NOT NULL`);
  }
  private one(sql: string, ...params: (string | number)[]): SkillAttemptRow | null {
    const row = this.db.exec<SkillAttemptDbRow>(sql, ...params).toArray()[0];
    return row === undefined ? null : decodeAttemptRow(row);
  }
  sql(): ChatSqlStorage {
    return this.db;
  }
  byOperation(operationId: string): SkillAttemptRow | null {
    return this.one(`SELECT * FROM skill_attempts WHERE operation_id = ? LIMIT 1`, operationId);
  }
  byId(attemptId: string): SkillAttemptRow | null {
    return this.one(`SELECT * FROM skill_attempts WHERE attempt_id = ? LIMIT 1`, attemptId);
  }
  byRetry(logicalOperationId: string, retryKey: string): SkillAttemptRow | null {
    return this.one(
      `SELECT * FROM skill_attempts WHERE logical_operation_id = ? AND retry_key = ? LIMIT 1`,
      logicalOperationId,
      retryKey,
    );
  }
  bySuccessor(failedAttemptId: string): SkillAttemptRow | null {
    return this.one(
      `SELECT * FROM skill_attempts WHERE retry_of = ? AND status <> 'released' LIMIT 1`,
      failedAttemptId,
    );
  }
  latestFailure(): SkillAttemptRow | null {
    return this.one(
      `SELECT * FROM skill_attempts a
       WHERE a.status IN ('incomplete','unavailable')
         AND a.rowid = (SELECT b.rowid FROM skill_attempts b
                        WHERE b.logical_operation_id = a.logical_operation_id
                          AND b.status IN ('accepted','incomplete','unavailable')
                        ORDER BY b.created_at DESC, b.rowid DESC LIMIT 1)
       ORDER BY a.created_at DESC, a.rowid DESC LIMIT 1`,
    );
  }
  insert(input: SkillInsertInput): SkillInsertOutcome {
    try {
      this.db.exec(
        `INSERT INTO skill_attempts (attempt_id, operation_id, logical_operation_id, retry_of,
         retry_key, pin, status, failure, catalog, catalog_digest, active, content,
         classification, recoverable, recovery_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'prepared', NULL, ?, ?, ?, ?, 'library', NULL, NULL, ?, ?)`,
        input.attemptId,
        input.operationId,
        input.logicalOperationId,
        input.retryOf,
        input.retryKey,
        JSON.stringify(input.pin),
        input.catalog,
        input.catalogDigest,
        JSON.stringify(input.active),
        input.content,
        input.now,
        input.now,
      );
      return "inserted";
    } catch {
      const existing =
        input.retryKey === null
          ? this.byOperation(input.operationId)
          : this.byRetry(input.logicalOperationId, input.retryKey);
      if (existing === null) return "conflict";
      const same =
        existing.operationId === input.operationId &&
        existing.logicalOperationId === input.logicalOperationId &&
        existing.retryOf === input.retryOf &&
        existing.retryKey === input.retryKey &&
        (existing.pin?.digest ?? null) === input.pin.digest &&
        existing.content === input.content;
      return same ? "existing" : "conflict";
    }
  }
  private setStatus(
    attemptId: string,
    status: SkillAttemptStatus,
    failure: string | null,
    from: readonly SkillAttemptStatus[],
  ): boolean {
    const current = this.byId(attemptId);
    if (current === null) return false;
    if (current.status === status && current.failure === failure) return true;
    if (!from.includes(current.status)) return false;
    this.db.exec(
      `UPDATE skill_attempts SET status = ?, failure = ?, updated_at = ? WHERE attempt_id = ?`,
      status,
      failure,
      Date.now(),
      attemptId,
    );
    return true;
  }
  accept(attemptId: string): boolean {
    return this.setStatus(attemptId, "accepted", null, ["prepared", "released"]);
  }
  incomplete(attemptId: string, message: string): boolean {
    return this.setStatus(attemptId, "incomplete", message, ["prepared", "accepted"]);
  }
  release(attemptId: string): boolean {
    return this.setStatus(attemptId, "released", null, ["prepared"]);
  }
  setRecoverability(attemptId: string, recoverable: boolean | null, reason: string | null): void {
    this.db.exec(
      `UPDATE skill_attempts SET recoverable = ?, recovery_reason = ?, updated_at = ?
       WHERE attempt_id = ?`,
      recoverable === null ? null : recoverable ? 1 : 0,
      reason,
      Date.now(),
      attemptId,
    );
  }
  classifyLegacy(operationId: string, now: number): void {
    this.db.exec(
      `INSERT INTO skill_attempts (attempt_id, operation_id, logical_operation_id, retry_of,
       retry_key, pin, status, failure, catalog, catalog_digest, active, content,
       classification, recoverable, recovery_reason, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, 'released', NULL, NULL, NULL, '[]', NULL,
               'legacy', NULL, NULL, ?, ?)
       ON CONFLICT(operation_id) DO NOTHING`,
      crypto.randomUUID(),
      operationId,
      operationId,
      now,
      now,
    );
  }
  async activate(attemptId: string, entry: ActiveEntry): Promise<readonly ActiveEntry[]> {
    const current = this.byId(attemptId);
    const open =
      current !== null && (current.status === "prepared" || current.status === "accepted");
    if (!open) return current?.active ?? [];
    const next = [...current.active.filter((item) => item.name !== entry.name), entry];
    if (new TextEncoder().encode(JSON.stringify(next)).byteLength > MAX_ACTIVE_TEXT_BYTES)
      return current.active;
    if ((await textDigest(entry.text)) !== entry.textDigest) return current.active;
    this.db.exec(
      `UPDATE skill_attempts SET active = ?, updated_at = ? WHERE attempt_id = ?`,
      JSON.stringify(next),
      Date.now(),
      attemptId,
    );
    return next;
  }
}
