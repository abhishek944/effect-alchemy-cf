import type { SubmissionRecord } from "@earendil-works/pi-durable";
import type { OperationReceipt } from "./chat-contract.ts";
import type { LedgerStatus } from "./chat-ledger.ts";
import { INFERENCE_FAILURE } from "./chat-model.ts";

/**
 * Exact native input receipt for one operation UUID. Accepted true requires a
 * scoped native input submission with this request id; unconfirmed false is
 * not a definite rejection. A verified user stop suppresses the safe error.
 */
export const buildReceipt = (
  operationId: string,
  record: SubmissionRecord | undefined,
  status: LedgerStatus | null,
): OperationReceipt => {
  if (record === undefined || record.type !== "input" || record.requestId !== operationId) {
    return { operationId, accepted: false, settled: false, error: null };
  }
  const settled = record.status === "done" || record.status === "unanswered";
  const failed = record.status === "unanswered" && status !== "stopped";
  return {
    operationId,
    accepted: true,
    settled,
    error: settled && failed ? INFERENCE_FAILURE : null,
  };
};
