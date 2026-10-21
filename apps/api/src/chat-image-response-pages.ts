import { decodeCandidate, ImageResponseError } from "./chat-image-response-codec.ts";
import type { ImageResponseCandidate } from "./chat-image-response-schema.ts";
import type { CandidateRow, CandidateWindowRow } from "./chat-image-response-table.ts";

export type ImageResponsePage = {
  operationIds: readonly string[];
  nextCursor: string | null;
};

export function decodeCandidateRow(row: CandidateRow): ImageResponseCandidate {
  const value = decodeCandidate(row.metadata);
  if (
    value.operationId !== row.operation_id ||
    value.logicalOperationId !== row.logical_operation_id ||
    value.conversationId !== row.conversation_id
  )
    throw new ImageResponseError("corrupt");
  return value;
}

/** One lookahead, at most 101 materialized rows per query. */
export function responsePageSize(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new ImageResponseError("invalid_input");
  return limit + 1;
}

function checkedRows(
  rows: readonly CandidateRow[],
  after: string | undefined,
): readonly ImageResponseCandidate[] {
  let previous = after ?? "";
  return rows.map((row) => {
    const candidate = decodeCandidateRow(row);
    if (candidate.operationId <= previous) throw new ImageResponseError("corrupt");
    previous = candidate.operationId;
    return candidate;
  });
}

export function attemptCandidates(
  rows: readonly CandidateRow[],
  logicalOperationId: string,
  after: string | undefined,
  limit: number,
): ImageResponsePage {
  const candidates = checkedRows(rows, after);
  if (candidates.some((candidate) => candidate.logicalOperationId !== logicalOperationId))
    throw new ImageResponseError("corrupt");
  const operationIds = Object.freeze(candidates.slice(0, limit).map((value) => value.operationId));
  return Object.freeze({
    operationIds,
    nextCursor: rows.length > limit ? (operationIds.at(-1) ?? null) : null,
  });
}

/** Cursor follows only indexed pending rows; contradictory binding state fails closed. */
export function unboundCandidates(
  rows: readonly CandidateWindowRow[],
  after: string | undefined,
  limit: number,
): ImageResponsePage {
  const candidates = checkedRows(rows, after);
  for (const row of rows) if (row.is_bound !== 0) throw new ImageResponseError("corrupt");
  const window = candidates.slice(0, limit);
  const operationIds = Object.freeze(window.map((candidate) => candidate.operationId));
  return Object.freeze({
    operationIds,
    nextCursor: rows.length > limit ? (window.at(-1)?.operationId ?? null) : null,
  });
}
