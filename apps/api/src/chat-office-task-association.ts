import type { OfficeSessionBinding } from "@starter/auth/office-session";
import type { OfficeSendTarget } from "@starter/office-contract";
import type { OfficeResolution, OfficeToolIntent } from "@starter/office-pi";
import type { TaskActor } from "@starter/office-server/ports";
import type { ImageOriginalBinding } from "./chat-image-response-schema.ts";
import type { ImageNativeAccess } from "./chat-image-request-types.ts";
import { requireImageAccess } from "./chat-image-request-accepted.ts";
import { freezeImageRequestValue } from "./chat-image-request-values.ts";
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
  readonly originals: readonly ImageOriginalBinding[];
};

/** Actual executing native input + original Send row. This issues NO task/native authority. */
export async function resolveOfficeTaskAssociation(
  resolution: OfficeResolution,
  access: ImageNativeAccess,
  records: ChatSendRecords,
): Promise<OfficeTaskAssociation | null> {
  try {
    const proof = await resolveOfficeCall(
      resolution.api,
      resolution.context,
      resolution.intent,
      access,
    );
    if (proof === null) return null;
    const candidate = proof.current.candidate;
    const session = records.officeSession(proof.operationId);
    if (
      session === null ||
      session.ownerId !== access.ownerId ||
      session.expiresAt <= Date.now() ||
      records.identity(proof.operationId) !== candidate.identityHash
    )
      return null;
    requireImageAccess(access, resolution.context);
    return freezeImageRequestValue(
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
  } catch {
    return null;
  }
}
