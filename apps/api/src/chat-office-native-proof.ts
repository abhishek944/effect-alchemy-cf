import { Schema } from "effect";
import { reportFailure } from "@starter/diagnostics";
import { Digest, Id } from "@starter/office-contract";
import {
  OFFICE_TOOL_NAME,
  OFFICE_PANEL_TOOL_NAME,
  type OfficeToolIntent,
} from "@starter/office-pi";
import { LiveDoc, type ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  requireAcceptedInputAccess,
  resolveAcceptedInput,
  type AcceptedInputAccess,
  type AcceptedInputContext,
  type BoundAcceptedInput,
} from "./chat-accepted-input.ts";
import { freezeAcceptedInputValue } from "./chat-accepted-input-values.ts";
import { decodeOption } from "./chat-internal.ts";
import { proveNativeLineage, type NativeProof } from "./chat-native-provenance.ts";
import { officeIntentMatches } from "./chat-office-proof-arguments.ts";

const IntentMemo = Schema.Struct({ version: Schema.Literal(1), operationId: Id, digest: Digest });
export type ProvenOfficeCall = NativeProof & {
  readonly callId: string;
  readonly current: BoundAcceptedInput;
};

/** Existing native input/tool lineage ONLY. No session, target, producer or native-write grant. */
export async function resolveOfficeCall(
  api: ToolExecutionApi,
  context: AcceptedInputContext,
  intent: OfficeToolIntent,
  access: AcceptedInputAccess,
): Promise<ProvenOfficeCall | null> {
  const deny = (reason: string): null => {
    reportFailure(undefined, {
      component: "office.admission",
      operation: "native-proof",
      reason,
      operationId: intent.operationId,
      taskId: api.taskId,
      callId: api.callId,
      event: "application.denial",
    });
    return null;
  };
  requireAcceptedInputAccess(access, context);
  if (api.conversationId !== access.conversationId) return deny("conversation-mismatch");
  if (!intent.step) return deny("intent-step-missing");
  if ((intent.attachmentId === undefined) === (intent.referenceId === undefined))
    return deny("intent-source-invalid");
  const stepMemo = await api.memo(`univer.step.v1.${intent.step}`, context);
  const memo = decodeOption(IntentMemo, await api.memo(`office.intent.v1.${intent.step}`, context));
  if (memo === null) return deny("intent-memo-invalid");
  if (memo.operationId !== intent.operationId) return deny("intent-memo-operation");
  if (memo.digest !== intent.digest) return deny("intent-memo-digest");
  let nativeDenial = "native-proof-result-missing";
  const proof = await proveNativeLineage(api, context, {
    storage: access.storage,
    runningTool: true,
    callNames: [OFFICE_TOOL_NAME, OFFICE_PANEL_TOOL_NAME],
    liveSlotName: true,
    inspectArguments: async ({ callName, arguments: value }) =>
      (await officeIntentMatches(value, intent, api, callName, stepMemo)) ? true : null,
    onDenied: (reason) => {
      nativeDenial = reason;
    },
  });
  if (proof === null) return deny(nativeDenial);
  const live = await api.snapshot(LiveDoc, api.conversationId, context);
  const submission = live?.run?.inputs[0];
  if (submission === undefined) return deny("live-submission-missing");
  if (String(submission) !== proof.submissionId) return deny("live-submission-id");
  if (live?.run?.inputs.length !== 1) return deny("live-submission-count");
  const current = await resolveAcceptedInput(access, api.conversationId, submission, context);
  if (current.candidate.operationId !== proof.operationId)
    return deny("accepted-operation-mismatch");
  requireAcceptedInputAccess(access, context);
  return freezeAcceptedInputValue({ ...proof, callId: api.callId, current }, true);
}
