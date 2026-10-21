import type { ChatSelection } from "@/lib/chat-capability-types";
import { request, unexpectedResponse } from "@/lib/chat-api";
import { isRecord, isUuid } from "@/lib/chat-validate-base";

/** Operation-scoped recovery state; never a version fallback. */
export type SkillRecovery = {
  logicalOperationId: string;
  failedAttemptId: string;
  /** False when the original pinned version is no longer available. */
  canRetry: boolean;
  message: string;
};

/** Strict accepted DTO; the boolean form is no longer trusted alone. */
export type SkillAttemptAccepted = {
  accepted: true;
  operationId: string;
  logicalOperationId: string;
};

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * Validates the full accepted identity and binds it to this exact command:
 * retry fixes the logical operation (the server owns the successor UUID), and
 * New Send must echo both the requested operation and logical ids.
 */
const parseAttemptAccepted = (
  value: unknown,
  expected: { operationId: string | null; logicalOperationId: string },
): SkillAttemptAccepted | null => {
  if (!isRecord(value) || value.accepted !== true) return null;
  if (!isUuid(value.operationId) || !isUuid(value.logicalOperationId)) return null;
  if (value.logicalOperationId !== expected.logicalOperationId) return null;
  if (expected.operationId !== null && value.operationId !== expected.operationId) return null;
  return {
    accepted: true,
    operationId: value.operationId,
    logicalOperationId: value.logicalOperationId,
  };
};

/** Original-version retry of one exact failed logical operation. */
export async function retrySkillOperation(
  id: string,
  input: { logicalOperationId: string; failedAttemptId: string; retryKey: string },
): Promise<SkillAttemptAccepted> {
  const accepted = parseAttemptAccepted(
    await request(`/api/chats/${encodeURIComponent(id)}/skills/retry`, json(input)),
    { operationId: null, logicalOperationId: input.logicalOperationId },
  );
  if (accepted === null) throw unexpectedResponse();
  return accepted;
}

/** Distinct new operation: current skills, explicit current selection. */
export async function newSkillSend(
  id: string,
  input: {
    sourceOperationId: string;
    sourceAttemptId: string;
    operationId: string;
    selection: ChatSelection;
  },
): Promise<SkillAttemptAccepted> {
  const accepted = parseAttemptAccepted(
    await request(`/api/chats/${encodeURIComponent(id)}/skills/new-send`, json(input)),
    { operationId: input.operationId, logicalOperationId: input.operationId },
  );
  if (accepted === null) throw unexpectedResponse();
  return accepted;
}
