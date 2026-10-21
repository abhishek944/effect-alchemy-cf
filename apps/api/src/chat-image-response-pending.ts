import type { AgentContext } from "agents";
import { ImageResponseError } from "./chat-image-response-codec.ts";
import type { CandidateWindowRow } from "./chat-image-response-table.ts";

/** Derived state only; candidate/binding/era history stays immutable. */
export class ImageResponsePending {
  private readonly db: AgentContext["storage"]["sql"];
  constructor(storage: AgentContext["storage"]) {
    this.db = storage.sql;
    storage.transactionSync(() => {
      // Table existence proves initialization only if coverage and DDL commit together.
      const known = this.db
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name = 'chat_image_response_pending'`,
        )
        .toArray()[0];
      this.db.exec(`CREATE TABLE IF NOT EXISTS chat_image_response_pending (
        operation_id TEXT PRIMARY KEY NOT NULL,
        is_pending INTEGER NOT NULL CHECK(is_pending IN (0, 1))
      )`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS chat_image_response_pending_active
        ON chat_image_response_pending(operation_id) WHERE is_pending = 1`);
      if (known === undefined) this.requireCoverage();
    });
  }

  /** No historical backfill: unindexed pending work must not silently disappear. */
  private requireCoverage(): void {
    const missing = this.db
      .exec<{ operation_id: string }>(
        `SELECT c.operation_id FROM chat_image_response_candidates c
         WHERE NOT EXISTS(SELECT 1 FROM chat_image_response_bindings b
           WHERE b.operation_id = c.operation_id)
         AND NOT EXISTS(SELECT 1 FROM chat_image_response_pending p
           WHERE p.operation_id = c.operation_id AND p.is_pending = 1)
         LIMIT 1`,
      )
      .toArray()[0];
    if (missing !== undefined) throw new ImageResponseError("corrupt");
  }

  /** Both mutations share the owning response store's synchronous transaction. */
  insert(operationId: string): void {
    this.db.exec(
      `INSERT INTO chat_image_response_pending (operation_id, is_pending) VALUES (?, 1)`,
      operationId,
    );
  }

  close(operationId: string): void {
    const changed = this.db
      .exec<{ operation_id: string }>(
        `UPDATE chat_image_response_pending SET is_pending = 0
         WHERE operation_id = ? AND is_pending = 1 RETURNING operation_id`,
        operationId,
      )
      .toArray();
    if (changed.length !== 1 || changed[0]?.operation_id !== operationId)
      throw new ImageResponseError("corrupt");
  }

  /** Bound history never enters the bounded metadata window. */
  window(after: string, limit: number): CandidateWindowRow[] {
    return this.db
      .exec<CandidateWindowRow>(
        `SELECT p.operation_id, c.logical_operation_id, c.conversation_id, c.metadata,
         EXISTS(SELECT 1 FROM chat_image_response_bindings b
           WHERE b.operation_id = p.operation_id) AS is_bound
         FROM (SELECT operation_id FROM chat_image_response_pending
           INDEXED BY chat_image_response_pending_active
           WHERE is_pending = 1 AND operation_id > ? ORDER BY operation_id LIMIT ?) p
         LEFT JOIN chat_image_response_candidates c ON c.operation_id = p.operation_id
         ORDER BY p.operation_id`,
        after,
        limit,
      )
      .toArray();
  }
}
