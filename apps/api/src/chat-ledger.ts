import type { AgentContext } from "agents";

export type ChatSqlStorage = AgentContext["storage"]["sql"];

export type LedgerStatus = "tentative" | "accepted" | "done" | "unanswered" | "stopped";
export type LatestOperation = { readonly operationId: string; readonly status: LedgerStatus };

const isLedgerStatus = (value: string): value is LedgerStatus =>
  value === "tentative" ||
  value === "accepted" ||
  value === "done" ||
  value === "unanswered" ||
  value === "stopped";

/**
 * Conversation-scoped durable operation ledger. It keeps the public operation
 * identity across runs and reconnects: the user-entry mapping that gives
 * messages their operation UUID, and the settled status the failure projection
 * reads without needing a viewer.
 */
export class ChatLedger {
  private readonly db: ChatSqlStorage;

  constructor(db: ChatSqlStorage) {
    this.db = db;
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS operations (
        operation_id TEXT PRIMARY KEY,
        entry_id TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    this.db.exec(`CREATE INDEX IF NOT EXISTS operations_entry_idx ON operations(entry_id)`);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )`,
    );
  }

  private cursor(): number {
    return (
      this.db
        .exec<{ value: number }>(`SELECT value FROM meta WHERE key = 'reconcile_rowid'`)
        .toArray()[0]?.value ?? 0
    );
  }

  /** Advances the reconcile cursor; the next page wraps when it runs out. */
  advance(rowid: number): void {
    this.db.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES ('reconcile_rowid', ?)`, rowid);
  }
  /**
   * Records an attempt before Pi sees it. An existing row keeps its entry,
   * creation time and terminal or already-accepted status; only non-terminal,
   * non-accepted rows reopen as tentative.
   */
  tentative(operationId: string, now: number): void {
    this.db.exec(
      `INSERT INTO operations (operation_id, entry_id, status, created_at, updated_at)
       VALUES (?, NULL, 'tentative', ?, ?)
       ON CONFLICT(operation_id) DO UPDATE SET
         status = CASE
           WHEN operations.status IN ('done', 'unanswered', 'stopped', 'accepted')
             THEN operations.status
           ELSE 'tentative'
         END,
         updated_at = excluded.updated_at`,
      operationId,
      now,
      now,
    );
  }

  /** Marks durable acceptance without resurrecting a terminal outcome. */
  accepted(operationId: string, now: number): void {
    this.db.exec(
      `UPDATE operations SET status = 'accepted', updated_at = ?
       WHERE operation_id = ? AND status IN ('tentative', 'accepted')`,
      now,
      operationId,
    );
  }

  setStatus(operationId: string, status: LedgerStatus, now: number): void {
    this.db.exec(
      `UPDATE operations SET status = ?, updated_at = ? WHERE operation_id = ? AND status != 'stopped'`,
      status,
      now,
      operationId,
    );
  }

  /** Called only after exact native withdrawal/mark proof, including raced unanswered. */
  stopped(operationId: string, now: number): void {
    this.db.exec(
      `UPDATE operations SET status = 'stopped', updated_at = ?
       WHERE operation_id = ? AND status IN ('tentative', 'accepted', 'unanswered')`,
      now,
      operationId,
    );
  }

  /** Links a public user entry to its operation once Pi places it. */
  recordEntry(operationId: string, entryId: number | undefined, now: number): void {
    if (entryId === undefined) return;
    this.db.exec(
      `UPDATE operations SET entry_id = ? WHERE operation_id = ?`,
      String(entryId),
      operationId,
    );
    this.db.exec(`UPDATE operations SET updated_at = ? WHERE operation_id = ?`, now, operationId);
  }

  entryOperation(entryId: number): string | null {
    const row = this.db
      .exec<{ operation_id: string }>(
        `SELECT operation_id FROM operations WHERE entry_id = ? LIMIT 1`,
        String(entryId),
      )
      .toArray()[0];
    return row?.operation_id ?? null;
  }

  /**
   * One bounded page of unmapped operations, starting after the durable
   * reconcile cursor and wrapping around, so older rows cannot starve.
   */
  unmappedPage(limit: number): { rowid: number; operationId: string }[] {
    const after = this.cursor();
    const page = this.db
      .exec<{ rowid: number; operation_id: string }>(
        `SELECT rowid, operation_id FROM operations
         WHERE entry_id IS NULL AND rowid > ? ORDER BY rowid LIMIT ?`,
        after,
        limit,
      )
      .toArray();
    const rows =
      page.length > 0
        ? page
        : this.db
            .exec<{ rowid: number; operation_id: string }>(
              `SELECT rowid, operation_id FROM operations
               WHERE entry_id IS NULL ORDER BY rowid LIMIT ?`,
              limit,
            )
            .toArray();
    return rows.map((row) => ({ rowid: row.rowid, operationId: row.operation_id }));
  }

  /** Ledger status for one operation UUID, or null when unknown. */
  statusOf(operationId: string): LedgerStatus | null {
    const row = this.db
      .exec<{ status: string }>(`SELECT status FROM operations WHERE operation_id = ?`, operationId)
      .toArray()[0];
    return row === undefined ? null : isLedgerStatus(row.status) ? row.status : "tentative";
  }

  latest(): LatestOperation | null {
    const row = this.db
      .exec<{ operation_id: string; status: string }>(
        `SELECT operation_id, status FROM operations ORDER BY rowid DESC LIMIT 1`,
      )
      .toArray()[0];
    if (row === undefined) return null;
    return {
      operationId: row.operation_id,
      status: isLedgerStatus(row.status) ? row.status : "tentative",
    };
  }
}
