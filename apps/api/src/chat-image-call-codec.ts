import { ImageCallAdmission } from "./chat-image-call-evidence.ts";
import { ImageCallState, type ImageCallView } from "./chat-image-call-schema.ts";
import { imageCallTotals, isUnsettledImageCall } from "./chat-image-call-cost.ts";
import type { CallSql, ImageCallRow } from "./chat-image-call-table.ts";
import {
  CALL_EVIDENCE_BYTES,
  CALL_STATE_BYTES,
  CallIndex,
  callJson,
  callParse,
  callValue,
  freezeCall,
  ImageCallError,
} from "./chat-image-call-values.ts";

export function encodeAdmission(input: ImageCallAdmission): string {
  callJson(input, CALL_EVIDENCE_BYTES);
  return callJson(callValue(ImageCallAdmission, input), CALL_EVIDENCE_BYTES);
}
export function outputCount(sql: CallSql, key: string): number {
  const count = sql
    .exec<{ n: number }>(`SELECT COUNT(*) AS n FROM chat_image_call_files WHERE call_key = ?`, key)
    .one().n;
  return callValue(CallIndex, count, "corrupt");
}
export function decodeCallRow(row: ImageCallRow, sql: CallSql): ImageCallView {
  try {
    const admission = callValue(
      ImageCallAdmission,
      callParse(row.evidence_json, CALL_EVIDENCE_BYTES),
      "corrupt",
    );
    const state = callValue(ImageCallState, callParse(row.state_json, CALL_STATE_BYTES), "corrupt");
    if (
      admission.key !== row.call_key ||
      admission.operationId !== row.operation_id ||
      admission.logicalOperationId !== row.logical_operation_id ||
      admission.assistantEntryId !== row.assistant_entry_id ||
      admission.modelIndex !== row.model_index ||
      admission.callPosition !== row.call_position ||
      admission.toolTaskId !== row.tool_task_id ||
      admission.nativeCallId !== row.native_call_id ||
      Number(state.started) !== row.started ||
      Number(state.dispatched) !== row.dispatched ||
      Number(state.failureLatched) !== row.blocked ||
      Number(isUnsettledImageCall(state)) !== row.unsettled ||
      state.outputCount !== outputCount(sql, admission.key)
    )
      throw new ImageCallError("corrupt");
    if (
      state.metadata === null
        ? state.cost.kind !== "unknown"
        : callJson(state.cost, CALL_STATE_BYTES) !== callJson(state.metadata.cost, CALL_STATE_BYTES)
    )
      throw new ImageCallError("corrupt");
    if (state.status === "complete" && state.metadata !== null) {
      for (const output of state.metadata.outputs)
        if (
          sql
            .exec(
              `SELECT output_index FROM chat_image_call_files
          WHERE call_key = ? AND output_index = ?`,
              admission.key,
              output.index,
            )
            .toArray()[0] === undefined
        )
          throw new ImageCallError("corrupt");
    }
    const totals = imageCallTotals(state);
    if (
      row.reported !== totals.reported ||
      row.estimated !== totals.estimated ||
      row.partial_estimated !== totals.partialEstimated ||
      row.unknown_calls !== totals.unknown ||
      row.partial_calls !== totals.partial ||
      row.other_calls !== totals.other ||
      row.known_calls !== totals.known ||
      row.not_dispatched !== totals.notDispatched
    )
      throw new ImageCallError("corrupt");
    return freezeCall({ admission, ...state });
  } catch {
    throw new ImageCallError("corrupt");
  }
}
