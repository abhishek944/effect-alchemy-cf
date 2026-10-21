import { Schema } from "effect";
import { Digest, Id } from "@starter/office-contract";
import { OFFICE_TOOL_NAME, type OfficeToolIntent } from "@starter/office-pi";
import {
  AssistantEntry,
  GenerationTask,
  LiveDoc,
  ToolTask,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable";
import { proveNativeInput, type NativeProof } from "./chat-account-proof.ts";
import { decodeOption } from "./chat-internal.ts";
import { requireImageAccess, resolveAcceptedImageInput } from "./chat-image-request-accepted.ts";
import {
  ImageEntryId,
  ImageSafeInteger,
  freezeImageRequestValue,
} from "./chat-image-request-values.ts";
import type { ImageBoundInput } from "./chat-image-response-schema.ts";
import type { ImageNativeAccess, ImageNativeContext } from "./chat-image-request-types.ts";
import { officeIntentMatches } from "./chat-office-proof-arguments.ts";

const IntentMemo = Schema.Struct({ version: Schema.Literal(1), operationId: Id, digest: Digest });
const ToolInput = Schema.Struct({ assistant: ImageEntryId, callId: Schema.String });
const Round = Schema.Struct({
  phase: Schema.Literal("tools"),
  assistant: ImageEntryId,
  tools: Schema.Array(ImageSafeInteger),
});
const Execute = Schema.Struct({
  phase: Schema.Literal("execute"),
  replay: Schema.Literal("unsafe"),
  arguments: Schema.Unknown,
});
export type ProvenOfficeCall = NativeProof & {
  readonly callId: string;
  readonly current: ImageBoundInput;
};

/** Existing native input/tool lineage ONLY. No session, target, producer or native-write grant. */
export async function resolveOfficeCall(
  api: ToolExecutionApi,
  context: ImageNativeContext,
  intent: OfficeToolIntent,
  access: ImageNativeAccess,
): Promise<ProvenOfficeCall | null> {
  try {
    requireImageAccess(access, context);
    if (api.conversationId !== access.conversationId) return null;
    const proof = await proveNativeInput(api, context, access.storage);
    if (proof === null) return null;
    const live = await api.snapshot(LiveDoc, api.conversationId, context);
    const submission = live?.run?.inputs[0];
    if (
      submission === undefined ||
      String(submission) !== proof.submissionId ||
      live?.run?.inputs.length !== 1
    )
      return null;
    const current = await resolveAcceptedImageInput(
      access,
      api.conversationId,
      submission,
      context,
    );
    if (current.candidate.operationId !== proof.operationId) return null;
    const memo = decodeOption(IntentMemo, await api.memo("office.intent.v1", context));
    if (memo === null || memo.operationId !== intent.operationId || memo.digest !== intent.digest)
      return null;
    const checked = await api.commit(async (tx) => {
      const tool = await tx.task(api.taskId);
      if (
        tool === undefined ||
        tool.kind !== ToolTask.definition.name ||
        tool.version !== ToolTask.definition.version ||
        tool.conversationId !== api.conversationId ||
        tool.abortRequested ||
        tool.state.status !== "running" ||
        tool.owner === undefined ||
        String(tool.owner) !== proof.generationTaskId
      )
        return false;
      const input = decodeOption(ToolInput, tool.input);
      const checkpoint = decodeOption(Execute, tool.state.checkpoint);
      if (
        input === null ||
        input.callId !== api.callId ||
        String(input.assistant) !== proof.assistantEntryId ||
        checkpoint === null ||
        !(await officeIntentMatches(checkpoint.arguments, intent, api))
      )
        return false;
      const generation = await tx.task(tool.owner);
      if (
        generation === undefined ||
        generation.kind !== GenerationTask.definition.name ||
        generation.version !== GenerationTask.definition.version ||
        generation.conversationId !== api.conversationId ||
        generation.abortRequested ||
        generation.state.status !== "waiting"
      )
        return false;
      const round = decodeOption(Round, generation.state.checkpoint);
      if (
        round === null ||
        round.assistant !== input.assistant ||
        !round.tools.includes(api.taskId)
      )
        return false;
      const assistant = await tx.entry(AssistantEntry, input.assistant);
      const message = assistant?.model?.[0];
      if (
        assistant?.conversationId !== api.conversationId ||
        String(assistant.byTaskId) !== proof.generationTaskId ||
        message?.role !== "assistant"
      )
        return false;
      const calls = message.content
        .filter((block) => block.type === "toolCall")
        .filter((call) => call.id === api.callId);
      // The SDK validates/coerces before storing execute arguments; raw model arguments may differ.
      if (calls.length !== 1 || calls[0]?.name !== OFFICE_TOOL_NAME) return false;
      const latest = await tx.doc(LiveDoc, api.conversationId);
      const slot = latest?.tools?.find((item) => item.taskId === api.taskId);
      return (
        String(latest?.run?.taskId) === proof.generationTaskId &&
        latest?.run?.inputs.length === 1 &&
        latest.run.inputs[0] === submission &&
        slot?.callId === api.callId &&
        slot.name === OFFICE_TOOL_NAME &&
        slot.status === "running"
      );
    }, context);
    if (!checked) return null;
    requireImageAccess(access, context);
    return freezeImageRequestValue({ ...proof, callId: api.callId, current }, true);
  } catch {
    return null;
  }
}
