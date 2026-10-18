import type { ChatSqlStorage } from "./chat-ledger.ts";
const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 10;
const RESERVATION_MS = 5 * 60_000;
const RESERVATION_LIMIT = 6;
export type AdmissionDecision = {
  readonly admitted: boolean;
  readonly duplicate: boolean;
  readonly reason: "accepted" | "duplicate" | "tentative" | "mismatch" | "rate" | "archived";
  readonly attemptId: string | null;
};
const denied = (reason: "mismatch" | "rate"): AdmissionDecision => ({
  admitted: false,
  duplicate: false,
  reason,
  attemptId: null,
});
/** Permanent identity plus expiring capacity; attempt ownership protects stale releases. */
export class ChatAdmission {
  private readonly db: ChatSqlStorage;
  constructor(db: ChatSqlStorage) {
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS operations (
      operation_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, text_hash TEXT NOT NULL,
      accepted INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS reservations (
      operation_id TEXT PRIMARY KEY, at INTEGER NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS reservation_attempts (
      operation_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, reserved_at INTEGER NOT NULL
    )`);
  }
  private charge(now: number): boolean {
    this.db.exec(`DELETE FROM reservations WHERE at < ?`, now - RESERVATION_MS);
    const leased = this.db.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM reservations`).one().n;
    if (leased >= RESERVATION_LIMIT) return false;
    return (
      this.db
        .exec<{ n: number }>(
          `SELECT COUNT(*) AS n FROM reservations WHERE at >= ?`,
          now - WINDOW_MS,
        )
        .one().n < WINDOW_LIMIT
    );
  }
  admit(
    operationId: string,
    chatId: string,
    textHash: string,
    now: number,
    nativeAccepted: boolean,
    attemptId: string,
  ): AdmissionDecision {
    const known = this.db
      .exec<{ chat_id: string; text_hash: string; accepted: number }>(
        `SELECT chat_id, text_hash, accepted FROM operations WHERE operation_id = ?`,
        operationId,
      )
      .toArray()[0];
    // Native evidence never bypasses permanent identity or invents a lost binding.
    if (known !== undefined && (known.chat_id !== chatId || known.text_hash !== textHash))
      return denied("mismatch");
    if (nativeAccepted && known === undefined) return denied("mismatch");
    if (known !== undefined && (nativeAccepted || known.accepted === 1)) {
      this.finalize(operationId, now);
      return { admitted: true, duplicate: true, reason: "duplicate", attemptId: null };
    }
    const lease = this.db
      .exec<{ at: number }>(`SELECT at FROM reservations WHERE operation_id = ?`, operationId)
      .toArray()[0];
    const leased = lease !== undefined && lease.at >= now - RESERVATION_MS;
    if (!leased && !this.charge(now)) return denied("rate");
    if (known === undefined)
      this.db.exec(
        `INSERT INTO operations (operation_id, chat_id, text_hash, accepted, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
        operationId,
        chatId,
        textHash,
        now,
        now,
      );
    const reservedAt = leased && lease !== undefined ? lease.at : now;
    if (!leased)
      this.db.exec(
        `INSERT OR REPLACE INTO reservations (operation_id, at) VALUES (?, ?)`,
        operationId,
        reservedAt,
      );
    this.db.exec(
      `INSERT OR REPLACE INTO reservation_attempts
      (operation_id, attempt_id, reserved_at) VALUES (?, ?, ?)`,
      operationId,
      attemptId,
      reservedAt,
    );
    return {
      admitted: true,
      duplicate: known !== undefined,
      reason: known === undefined ? "accepted" : "tentative",
      attemptId,
    };
  }
  /** Repair acceptance without refreshing an existing/expired duplicate lease. */
  finalize(operationId: string, now: number): void {
    const known = this.db
      .exec<{ accepted: number; created_at: number }>(
        `SELECT accepted, created_at FROM operations WHERE operation_id = ?`,
        operationId,
      )
      .toArray()[0];
    if (known === undefined) return;
    const attempt = this.db
      .exec<{ reserved_at: number }>(
        `SELECT reserved_at FROM reservation_attempts WHERE operation_id = ?`,
        operationId,
      )
      .toArray()[0];
    if (known.accepted !== 1)
      this.db.exec(
        `UPDATE operations SET accepted = 1, updated_at = ? WHERE operation_id = ?`,
        now,
        operationId,
      );
    this.db.exec(
      `INSERT OR IGNORE INTO reservations (operation_id, at) VALUES (?, ?)`,
      operationId,
      attempt?.reserved_at ?? known.created_at,
    );
  }
  /** One atomic deletion protects both accepted operations and newer tentative owners. */
  release(operationId: string, attemptId: string | null): void {
    if (attemptId === null) return;
    this.db.exec(
      `DELETE FROM reservations WHERE operation_id = ?
      AND EXISTS (SELECT 1 FROM operations o WHERE o.operation_id = reservations.operation_id AND o.accepted = 0)
      AND EXISTS (SELECT 1 FROM reservation_attempts a
        WHERE a.operation_id = reservations.operation_id AND a.attempt_id = ?)`,
      operationId,
      attemptId,
    );
  }
}
