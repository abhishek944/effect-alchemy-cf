import { reportFailure } from "@starter/diagnostics";
import type { OfficeSessionBinding } from "@starter/auth/office-session";
import type { ChatReferenceInput, OfficeSendTarget } from "@starter/office-contract";
import type { OfficeResolution, OfficeToolIntent } from "@starter/office-pi";
import type { TaskActor } from "@starter/office-server/ports";
import type { AcceptedOriginalBinding } from "./chat-accepted-input-schema.ts";
import { requireAcceptedInputAccess, type AcceptedInputAccess } from "./chat-accepted-input.ts";
import { freezeAcceptedInputValue } from "./chat-accepted-input-values.ts";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";
import { readOfficeRetainedOriginal } from "./chat-office-retained.ts";
import type { OfficeTaskFile } from "./office-task-file.ts";
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
  /** Explicit requested file retained from an earlier Send of this chat; never a new Send input. */
  readonly retained: OfficeTaskFile | null;
  readonly reference?: ChatReferenceInput;
};

/** Actual executing native input + original Send row. This issues NO task/native authority. */
export async function resolveOfficeTaskAssociation(
  resolution: OfficeResolution,
  access: AcceptedInputAccess,
  records: ChatSendRecords,
  env: ConversationFileEnv,
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
    const referenceId = resolution.intent.referenceId;
    const reference =
      referenceId === undefined
        ? undefined
        : candidate.referenceInputs?.find((ref) => ref.id === referenceId);
    if (
      referenceId !== undefined &&
      (reference?.kind !== "native" || resolution.intent.attachmentId !== undefined)
    )
      return deny("accepted-reference-missing");
    const requested = resolution.intent.attachmentId;
    const fromSend =
      requested === undefined
        ? undefined
        : candidate.originals.find((file) => file.fileId === requested);
    const retained =
      requested === undefined || fromSend !== undefined
        ? null
        : await readOfficeRetainedOriginal(env, access.ownerId, access.chatId, requested);
    requireAcceptedInputAccess(access, resolution.context);
    if (requested !== undefined && fromSend === undefined && retained === null)
      return deny("retained-original-missing");
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
        target: reference?.kind === "native" ? reference.target : (candidate.officeTarget ?? null),
        ...(reference === undefined ? {} : { reference }),
        originals: candidate.originals,
        retained,
      },
      true,
    );
  }
}
