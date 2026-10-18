/**
 * Terminal action receipts and originating-chat Undo pointers.
 *
 * A receipt is the durable outcome of one frozen account action, written exactly
 * once in the same transaction as the theme change it describes. A retried or
 * duplicated delivery returns the original receipt instead of applying a second
 * change, and a fixed rolling cache is no longer used, so an old action id can
 * never be reinterpreted as a fresh write. The Undo pointer is keyed by trusted
 * origin (conversation object scope plus native conversation id) so only the chat
 * that made a change can undo it, and only while that change is still current.
 */
import type { AgentContext } from "agents";
import { decodeOption } from "./chat-internal.ts";
import {
  ActionReceipt,
  ThemeActionOutcome,
  UndoTarget,
  type ActionId,
  type ThemeOrigin,
} from "./theme-model.ts";

export class ThemeReceipts {
  private readonly storage: AgentContext["storage"];

  constructor(storage: AgentContext["storage"]) {
    this.storage = storage;
    const db = storage.sql;
    db.exec(`CREATE TABLE IF NOT EXISTS theme_receipts (
      action_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, origin TEXT NOT NULL,
      before_theme TEXT NOT NULL, before_revision INTEGER NOT NULL,
      result TEXT NOT NULL, created_at INTEGER NOT NULL
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS theme_undo_targets (
      origin TEXT PRIMARY KEY, target_action_id TEXT NOT NULL,
      result_revision INTEGER NOT NULL, created_at INTEGER NOT NULL
    )`);
  }

  get(actionId: ActionId): ActionReceipt | null {
    const row = this.storage.sql
      .exec<{
        action_id: string;
        fingerprint: string;
        origin: string;
        before_theme: string;
        before_revision: number;
        result: string;
      }>(`SELECT * FROM theme_receipts WHERE action_id = ?`, actionId)
      .toArray()[0];
    if (row === undefined) return null;
    const result: unknown = JSON.parse(row.result);
    return decodeOption(ActionReceipt, {
      actionId: row.action_id,
      fingerprint: row.fingerprint,
      origin: row.origin,
      before: { theme: row.before_theme, revision: row.before_revision },
      result,
    });
  }

  put(receipt: ActionReceipt, now: number): void {
    this.storage.sql.exec(
      `INSERT INTO theme_receipts
       (action_id, fingerprint, origin, before_theme, before_revision, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      receipt.actionId,
      receipt.fingerprint,
      receipt.origin,
      receipt.before.theme,
      receipt.before.revision,
      JSON.stringify(receipt.result),
      now,
    );
  }

  target(origin: ThemeOrigin): UndoTarget | null {
    const row = this.storage.sql
      .exec<{ target_action_id: string; result_revision: number; result: string }>(
        `SELECT t.target_action_id, t.result_revision, r.result AS result
         FROM theme_undo_targets t LEFT JOIN theme_receipts r ON r.action_id = t.target_action_id
         WHERE t.origin = ?`,
        origin,
      )
      .toArray()[0];
    if (row === undefined) return null;
    const parsed: unknown = row.result === null ? null : JSON.parse(row.result);
    const result = parsed === null ? null : decodeOption(ThemeActionOutcome, parsed);
    const theme = result !== null && result.ok ? result.theme : null;
    if (theme === null) return null;
    return decodeOption(UndoTarget, {
      targetActionId: row.target_action_id,
      expectedRevision: row.result_revision,
      theme,
    });
  }

  setTarget(origin: ThemeOrigin, target: UndoTarget, now: number): void {
    this.storage.sql.exec(
      `INSERT INTO theme_undo_targets (origin, target_action_id, result_revision, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(origin) DO UPDATE SET target_action_id = excluded.target_action_id,
       result_revision = excluded.result_revision, created_at = excluded.created_at`,
      origin,
      target.targetActionId,
      target.expectedRevision,
      now,
    );
  }

  clearTarget(origin: ThemeOrigin): void {
    this.storage.sql.exec(`DELETE FROM theme_undo_targets WHERE origin = ?`, origin);
  }

  hasAnyTarget(): boolean {
    return (
      this.storage.sql
        .exec<{ origin: string }>(`SELECT origin FROM theme_undo_targets LIMIT 1`)
        .toArray()[0] !== undefined
    );
  }
}
