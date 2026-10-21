import type { AgentContext } from "agents";
import type { ImageCallAdmission } from "./chat-image-call-evidence.ts";
import type { ImageCallState } from "./chat-image-call-schema.ts";
import { imageCallTotals, isUnsettledImageCall } from "./chat-image-call-cost.ts";
import { CALL_STATE_BYTES, callJson } from "./chat-image-call-values.ts";

export type CallSql = AgentContext["storage"]["sql"];
export type ImageAssistantPosition = { readonly entry: number; readonly index: number };
export type ImageCallRow = {
  call_key: string;
  operation_id: string;
  logical_operation_id: string;
  assistant_entry_id: number;
  model_index: number;
  call_position: number;
  tool_task_id: string;
  native_call_id: string;
  evidence_json: string;
  state_json: string;
  started: number;
  dispatched: number;
  blocked: number;
  unsettled: number;
  reported: number;
  estimated: number;
  partial_estimated: number;
  unknown_calls: number;
  partial_calls: number;
  other_calls: number;
  known_calls: number;
  not_dispatched: number;
};
export type CallAggregate = {
  callCount: number;
  startedCalls: number;
  dispatchedCalls: number;
  notDispatchedCalls: number;
  reportedUsd: number;
  estimatedUsd: number;
  partialEstimatedUsd: number;
  unknownCalls: number;
  partialCalls: number;
  otherCurrencyCalls: number;
  knownUsdCalls: number;
};
export class ImageCallTable {
  readonly sql: CallSql;
  constructor(storage: AgentContext["storage"]) {
    this.sql = storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chat_image_call_evidence (
      call_key TEXT PRIMARY KEY NOT NULL, operation_id TEXT NOT NULL, logical_operation_id TEXT NOT NULL,
      assistant_entry_id INTEGER NOT NULL, model_index INTEGER NOT NULL, call_position INTEGER NOT NULL,
      tool_task_id TEXT NOT NULL, native_call_id TEXT NOT NULL, evidence_json TEXT NOT NULL,
      state_json TEXT NOT NULL, started INTEGER NOT NULL, dispatched INTEGER NOT NULL,
      blocked INTEGER NOT NULL, unsettled INTEGER NOT NULL,
      reported REAL NOT NULL, estimated REAL NOT NULL, partial_estimated REAL NOT NULL,
      unknown_calls INTEGER NOT NULL, partial_calls INTEGER NOT NULL,
      other_calls INTEGER NOT NULL, known_calls INTEGER NOT NULL, not_dispatched INTEGER NOT NULL,
      UNIQUE(assistant_entry_id, model_index, call_position), UNIQUE(tool_task_id, native_call_id)
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS chat_image_call_logical
      ON chat_image_call_evidence(logical_operation_id, started, dispatched, blocked)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS chat_image_call_unsettled
      ON chat_image_call_evidence(unsettled, call_key)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chat_image_call_files (
      call_key TEXT NOT NULL, output_index INTEGER NOT NULL, file_id TEXT NOT NULL UNIQUE,
      assistant_entry_id INTEGER NOT NULL, model_index INTEGER NOT NULL, call_position INTEGER NOT NULL,
      file_json TEXT NOT NULL, PRIMARY KEY(call_key, output_index),
      UNIQUE(assistant_entry_id, model_index, call_position, output_index)
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS chat_image_call_assistant_files
      ON chat_image_call_files(assistant_entry_id, model_index, call_position, output_index)`);
  }
  get(key: string): ImageCallRow | undefined {
    return this.sql
      .exec<ImageCallRow>(`SELECT * FROM chat_image_call_evidence WHERE call_key = ?`, key)
      .toArray()[0];
  }
  collision(input: ImageCallAdmission): boolean {
    return (
      this.sql
        .exec(
          `SELECT call_key FROM chat_image_call_evidence
      WHERE (assistant_entry_id = ? AND model_index = ? AND call_position = ?)
      OR (tool_task_id = ? AND native_call_id = ?) LIMIT 1`,
          input.assistantEntryId,
          input.modelIndex,
          input.callPosition,
          input.toolTaskId,
          input.nativeCallId,
        )
        .toArray().length !== 0
    );
  }
  insert(input: ImageCallAdmission, evidence: string, state: ImageCallState): void {
    this.sql.exec(
      `INSERT INTO chat_image_call_evidence VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0)`,
      input.key,
      input.operationId,
      input.logicalOperationId,
      input.assistantEntryId,
      input.modelIndex,
      input.callPosition,
      input.toolTaskId,
      input.nativeCallId,
      evidence,
      callJson(state, CALL_STATE_BYTES),
    );
  }
  write(key: string, state: ImageCallState): void {
    const cost = imageCallTotals(state);
    this.sql.exec(
      `UPDATE chat_image_call_evidence SET state_json = ?, started = ?, dispatched = ?,
      blocked = ?, unsettled = ?, reported = ?, estimated = ?, partial_estimated = ?, unknown_calls = ?,
      partial_calls = ?, other_calls = ?, known_calls = ?, not_dispatched = ? WHERE call_key = ?`,
      callJson(state, CALL_STATE_BYTES),
      Number(state.started),
      Number(state.dispatched),
      Number(state.failureLatched),
      Number(isUnsettledImageCall(state)),
      cost.reported,
      cost.estimated,
      cost.partialEstimated,
      cost.unknown,
      cost.partial,
      cost.other,
      cost.known,
      cost.notDispatched,
      key,
    );
  }
  unsettled(after: string, limit: number): ImageCallRow[] {
    return this.sql
      .exec<ImageCallRow>(
        `SELECT * FROM chat_image_call_evidence
      WHERE unsettled = 1 AND call_key > ? ORDER BY call_key LIMIT ?`,
        after,
        limit,
      )
      .toArray();
  }
  hasAssistantFiles(entryId: number, modelIndex: number): boolean {
    return (
      this.sql
        .exec(
          `SELECT 1 FROM chat_image_call_files
      WHERE assistant_entry_id = ? AND model_index = ? LIMIT 1`,
          entryId,
          modelIndex,
        )
        .toArray().length !== 0
    );
  }
  recent(position?: ImageAssistantPosition): ImageCallRow[] {
    return this.sql
      .exec<ImageCallRow>(
        `SELECT * FROM chat_image_call_evidence
         WHERE (? IS NULL OR (assistant_entry_id = ? AND model_index = ?))
         ORDER BY rowid DESC LIMIT 10`,
        position?.entry ?? null,
        position?.entry ?? null,
        position?.index ?? null,
      )
      .toArray();
  }
  logical(id: string, excluded?: string): { started: number; dispatched: number; blocked: number } {
    return this.sql
      .exec<{ started: number; dispatched: number; blocked: number }>(
        `SELECT COALESCE(MAX(started),0) AS started, COALESCE(MAX(dispatched),0) AS dispatched,
       COALESCE(MAX(blocked),0) AS blocked FROM chat_image_call_evidence
       WHERE logical_operation_id = ? AND (? IS NULL OR operation_id != ?)`,
        id,
        excluded ?? null,
        excluded ?? null,
      )
      .one();
  }
  aggregate(position?: ImageAssistantPosition): CallAggregate {
    return this.sql
      .exec<CallAggregate>(
        `SELECT COUNT(*) AS callCount,
      COALESCE(SUM(started),0) AS startedCalls, COALESCE(SUM(dispatched),0) AS dispatchedCalls,
      COALESCE(SUM(not_dispatched),0) AS notDispatchedCalls,
      COALESCE(SUM(reported),0) AS reportedUsd, COALESCE(SUM(estimated),0) AS estimatedUsd,
      COALESCE(SUM(partial_estimated),0) AS partialEstimatedUsd,
      COALESCE(SUM(unknown_calls),0) AS unknownCalls, COALESCE(SUM(partial_calls),0) AS partialCalls,
      COALESCE(SUM(other_calls),0) AS otherCurrencyCalls, COALESCE(SUM(known_calls),0) AS knownUsdCalls
      FROM chat_image_call_evidence
      WHERE (? IS NULL OR (assistant_entry_id = ? AND model_index = ?))`,
        position?.entry ?? null,
        position?.entry ?? null,
        position?.index ?? null,
      )
      .one();
  }
}
