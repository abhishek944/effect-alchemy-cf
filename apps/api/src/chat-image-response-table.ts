import type { AgentContext } from "agents";
import type { ImageAcceptedBinding, ImageResponseCandidate } from "./chat-image-response-schema.ts";
import { ImageResponsePending } from "./chat-image-response-pending.ts";

export type CandidateRow = {
  operation_id: string;
  logical_operation_id: string;
  conversation_id: string;
  metadata: string;
};
export type CandidateWindowRow = CandidateRow & { is_bound: number };
const bindingColumns = `operation_id AS operationId, submission_id AS submissionId,
  conversation_id AS conversationId, entry_id AS entryId,
  model_index AS modelIndex, input_digest AS inputDigest`;

/** SQL details remain local; callers own synchronous transaction boundaries. */
export class ImageResponseTable {
  private readonly db: AgentContext["storage"]["sql"];
  private readonly pending: ImageResponsePending;
  constructor(storage: AgentContext["storage"]) {
    this.db = storage.sql;
    this.db.exec(`CREATE TABLE IF NOT EXISTS chat_image_response_candidates (
      operation_id TEXT PRIMARY KEY NOT NULL, logical_operation_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL, metadata TEXT NOT NULL
    )`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS chat_image_response_attempts
      ON chat_image_response_candidates(logical_operation_id, operation_id)`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS chat_image_response_bindings (
      operation_id TEXT PRIMARY KEY NOT NULL, submission_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL, entry_id INTEGER NOT NULL CHECK(entry_id > 0),
      model_index INTEGER NOT NULL CHECK(model_index >= 0), input_digest TEXT NOT NULL,
      UNIQUE(conversation_id, entry_id, model_index)
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS chat_image_response_eras (
      conversation_id TEXT PRIMARY KEY NOT NULL,
      first_entry_id INTEGER NOT NULL CHECK(first_entry_id > 0)
    )`);
    this.pending = new ImageResponsePending(storage);
  }

  candidate(operationId: string): CandidateRow | undefined {
    return this.db
      .exec<CandidateRow>(
        `SELECT operation_id, logical_operation_id, conversation_id, metadata
       FROM chat_image_response_candidates WHERE operation_id = ?`,
        operationId,
      )
      .toArray()[0];
  }

  insertCandidate(value: ImageResponseCandidate, metadata: string): void {
    this.db.exec(
      `INSERT INTO chat_image_response_candidates
      (operation_id, logical_operation_id, conversation_id, metadata) VALUES (?, ?, ?, ?)`,
      value.operationId,
      value.logicalOperationId,
      value.conversationId,
      metadata,
    );
    this.pending.insert(value.operationId);
  }

  operationBinding(operationId: string): ImageAcceptedBinding | undefined {
    return this.db
      .exec<ImageAcceptedBinding>(
        `SELECT ${bindingColumns}
      FROM chat_image_response_bindings WHERE operation_id = ?`,
        operationId,
      )
      .toArray()[0];
  }

  entryBinding(
    conversationId: string,
    entryId: number,
    modelIndex: number,
  ): ImageAcceptedBinding | undefined {
    return this.db
      .exec<ImageAcceptedBinding>(
        `SELECT ${bindingColumns}
      FROM chat_image_response_bindings
      WHERE conversation_id = ? AND entry_id = ? AND model_index = ?`,
        conversationId,
        entryId,
        modelIndex,
      )
      .toArray()[0];
  }

  insertBinding(value: ImageAcceptedBinding): void {
    this.db.exec(
      `INSERT INTO chat_image_response_bindings
      (operation_id, submission_id, conversation_id, entry_id, model_index, input_digest)
      VALUES (?, ?, ?, ?, ?, ?)`,
      value.operationId,
      value.submissionId,
      value.conversationId,
      value.entryId,
      value.modelIndex,
      value.inputDigest,
    );
    this.pending.close(value.operationId);
  }

  start(conversationId: string): number | undefined {
    return this.db
      .exec<{ first_entry_id: number }>(
        `SELECT first_entry_id FROM chat_image_response_eras WHERE conversation_id = ?`,
        conversationId,
      )
      .toArray()[0]?.first_entry_id;
  }

  firstBoundEntry(conversationId: string): number | undefined {
    return this.db
      .exec<{ entry_id: number }>(
        `SELECT entry_id FROM chat_image_response_bindings WHERE conversation_id = ?
       ORDER BY entry_id, model_index LIMIT 1`,
        conversationId,
      )
      .toArray()[0]?.entry_id;
  }

  insertStart(conversationId: string, entryId: number): void {
    this.db.exec(
      `INSERT INTO chat_image_response_eras (conversation_id, first_entry_id)
      VALUES (?, ?)`,
      conversationId,
      entryId,
    );
  }

  /** Only active pending rows consume the bounded reconstruction window. */
  candidateWindow(after: string, limit: number): CandidateWindowRow[] {
    return this.pending.window(after, limit);
  }

  page(logicalOperationId: string, after: string, limit: number): CandidateRow[] {
    return this.db
      .exec<CandidateRow>(
        `SELECT operation_id, logical_operation_id, conversation_id, metadata
       FROM chat_image_response_candidates
       WHERE logical_operation_id = ? AND operation_id > ? ORDER BY operation_id LIMIT ?`,
        logicalOperationId,
        after,
        limit,
      )
      .toArray();
  }
}
