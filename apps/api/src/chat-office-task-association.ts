import { reportFailure } from "@starter/diagnostics";
import type { OfficeSessionBinding } from "@starter/auth/office-session";
import type { OfficeSendTarget } from "@starter/office-contract";
import type { OfficeResolution, OfficeToolIntent } from "@starter/office-pi";
import type { TaskActor } from "@starter/office-server/ports";
import type { AcceptedOriginalBinding } from "./chat-accepted-input-schema.ts";
import { requireAcceptedInputAccess, type AcceptedInputAccess } from "./chat-accepted-input.ts";
import { freezeAcceptedInputValue } from "./chat-accepted-input-values.ts";
import { resolveOfficeCall } from "./chat-office-native-proof.ts";
import type { ChatSendRecords } from "./chat-send-records.ts";

/** Private server metadata ONLY. Never expose session association to browser, Node or model. */
export type OfficeTaskAssociation = {
  readonly session: OfficeSessionBinding;
  readonly chatId: string;
  readonly chatScope: string;
  readonly callId: string;
  readonly acceptedInput: TaskActor["acceptedInput"];
  readonly intent: OfficeToolIntent;
  readonly target: OfficeSendTarget | null;
  readonly originals: readonly AcceptedOriginalBinding[];
};

/** Actual executing native input + original Send row. This issues NO task/native authority. */
export async function resolveOfficeTaskAssociation(
  resolution: OfficeResolution,
  access: AcceptedInputAccess,
  records: ChatSendRecords,
): Promise<OfficeTaskAssociation | null> {
  {
    const proof = await resolveOfficeCall(
      resolution.api,
      resolution.context,
      resolution.intent,
      access,
    );
    if (proof === null) return null;
    const candidate = proof.current.candidate;
    const session = records.officeSession(proof.operationId);
    const deny = (reason: string): null => {
      reportFailure(undefined, {
        component: "office.admission",
        operation: "association",
        reason,
        operationId: resolution.intent.operationId,
        taskId: resolution.api.taskId,
        callId: resolution.api.callId,
        event: "application.denial",
      });
      return null;
    };
    if (session === null) return deny("session-missing");
    if (session.ownerId !== access.ownerId) return deny("session-owner");
    if (session.expiresAt <= Date.now()) return deny("session-expired");
    if (records.identity(proof.operationId) !== candidate.identityHash)
      return deny("accepted-input-identity");
    requireAcceptedInputAccess(access, resolution.context);
    return freezeAcceptedInputValue(
      {
        session,
        chatId: access.chatId,
        chatScope: access.chatScope,
        callId: proof.callId,
        acceptedInput: {
          requestId: proof.operationId,
          submissionId: proof.submissionId,
          conversationId: String(access.conversationId),
          toolTaskId: proof.toolTaskId,
          generationTaskId: proof.generationTaskId,
          assistantEntryId: proof.assistantEntryId,
          digest: proof.current.binding.inputDigest,
        },
        intent: structuredClone(resolution.intent),
        target: candidate.officeTarget ?? null,
        originals: candidate.originals,
      },
      true,
    );
  }
}
