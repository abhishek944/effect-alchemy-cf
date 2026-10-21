/**
 * Durable row for a positively evidenced native run whose skills row is lost.
 *
 * The row records a truthful unrecoverable incomplete failure only: no pin, no
 * catalog, no active guidance and no content are fabricated, so New Send must
 * independently prove the accepted native caption/files or ask for a fresh
 * message. Corrupt guidance never erases this attribution.
 */
import type { ChatSqlStorage } from "./chat-ledger.ts";
import type { ChatSkillsStore } from "./chat-skills-store.ts";

const insertLost = (
  db: ChatSqlStorage,
  operationId: string,
  logicalOperationId: string,
  message: string,
  now: number,
): void => {
  // attempt_id follows attemptId === native operationId so byId finds it; the
  // logical id comes from the authoritative send record, never a guess.
  db.exec(
    `INSERT INTO skill_attempts (attempt_id, operation_id, logical_operation_id, retry_of,
     retry_key, pin, status, failure, catalog, catalog_digest, active, content, classification,
     recoverable, recovery_reason, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, 'incomplete', ?, NULL, NULL, '[]', NULL,
             'library', 0, ?, ?, ?)`,
    operationId,
    operationId,
    logicalOperationId,
    message,
    message,
    now,
    now,
  );
};

export const recordLostAttempt = (
  store: ChatSkillsStore,
  operationId: string,
  logicalOperationId: string,
  message: string,
  now: number,
): boolean => {
  const existing = store.byOperation(operationId);
  if (existing !== null)
    return existing.status === "incomplete" || existing.status === "unavailable";
  try {
    insertLost(store.sql(), operationId, logicalOperationId, message, now);
    return true;
  } catch {
    return false;
  }
};
