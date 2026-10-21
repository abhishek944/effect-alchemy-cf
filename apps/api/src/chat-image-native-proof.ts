import type { ImageArgs } from "@abhishek944/pi-image-gen/core";
import { Schema } from "effect";
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
import type { ImageBoundInput, ImageResponseCandidate } from "./chat-image-response-schema.ts";
import type { ImageNativeAccess, ImageNativeContext } from "./chat-image-request-types.ts";
import {
  freezeImageRequestValue,
  ImageEntryId,
  ImageSafeInteger,
  sameImageRequestValue,
} from "./chat-image-request-values.ts";
import {
  decodeNativeImageArguments,
  type NativeImageArguments,
} from "./chat-image-native-proof-args.ts";

export type { ImageNativeAccess } from "./chat-image-request-types.ts";
export type ProvenImageCall = NativeProof & {
  readonly callId: string;
  readonly snapshot: ImageResponseCandidate;
  readonly current: ImageBoundInput;
  readonly args: NativeImageArguments;
};

const ToolInput = Schema.Struct({
  assistant: ImageEntryId,
  callId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
});
const ToolsCheckpoint = Schema.Struct({
  phase: Schema.Literal("tools"),
  assistant: ImageEntryId,
  tools: Schema.Array(ImageSafeInteger),
});
const ExecuteCheckpoint = Schema.Struct({
  phase: Schema.Literal("execute"),
  replay: Schema.Literal("unsafe"),
  arguments: Schema.Unknown,
});

/** Exact native lineage only; T20/T25 still authorize sources, reserve and consume once. */
export const resolveImageCall = async (
  api: ToolExecutionApi,
  context: ImageNativeContext,
  args: Readonly<ImageArgs>,
  access: ImageNativeAccess,
): Promise<ProvenImageCall | null> => {
  try {
    requireImageAccess(access, context);
    if (api.conversationId !== access.conversationId) return null;
    const supplied = decodeNativeImageArguments(args);
    if (supplied === null) return null;
    // Deliberately no AccountOperation/theme-intent lookup or model-text intent regex.
    const proof = await proveNativeInput(api, context, access.storage);
    if (proof === null) return null;
    const live = await api.snapshot(LiveDoc, api.conversationId, context);
    const submissionId = live?.run?.inputs[0];
    if (
      submissionId === undefined ||
      String(submissionId) !== proof.submissionId ||
      live?.run?.inputs.length !== 1
    )
      return null;
    const current = await resolveAcceptedImageInput(
      access,
      api.conversationId,
      submissionId,
      context,
    );
    if (current.candidate.operationId !== proof.operationId) return null;
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
        return null;
      const input = decodeOption(ToolInput, tool.input);
      const checkpoint = decodeOption(ExecuteCheckpoint, tool.state.checkpoint);
      if (
        input === null ||
        input.callId !== api.callId ||
        String(input.assistant) !== proof.assistantEntryId ||
        checkpoint === null
      )
        return null;
      const generation = await tx.task(tool.owner);
      if (
        generation?.kind !== GenerationTask.definition.name ||
        generation.version !== GenerationTask.definition.version ||
        generation.conversationId !== api.conversationId ||
        generation.abortRequested ||
        generation.state.status !== "waiting"
      )
        return null;
      const round = decodeOption(ToolsCheckpoint, generation.state.checkpoint);
      if (round?.assistant !== input.assistant || !round.tools.includes(api.taskId)) return null;
      const final = decodeNativeImageArguments(checkpoint.arguments);
      if (final === null || !sameImageRequestValue(final, supplied)) return null;
      const assistant = await tx.entry(AssistantEntry, input.assistant);
      const message = assistant?.model?.[0];
      if (
        assistant?.conversationId !== api.conversationId ||
        String(assistant.byTaskId) !== proof.generationTaskId ||
        message?.role !== "assistant"
      )
        return null;
      const calls = message.content
        .filter((block) => block.type === "toolCall")
        .filter((call) => call.id === api.callId);
      if (calls.length !== 1 || calls[0]?.name !== "image_generate") return null;
      const liveNow = await tx.doc(LiveDoc, api.conversationId);
      const slot = liveNow?.tools?.find((item) => item.taskId === api.taskId);
      if (
        String(liveNow?.run?.taskId) !== proof.generationTaskId ||
        liveNow?.run?.inputs.length !== 1 ||
        liveNow.run.inputs[0] !== submissionId ||
        slot?.callId !== api.callId ||
        slot.name !== "image_generate" ||
        slot.status !== "running"
      )
        return null;
      return final;
    }, context);
    if (checked === null || checked === undefined) return null;
    requireImageAccess(access, context);
    return freezeImageRequestValue(
      {
        ...proof,
        callId: api.callId,
        snapshot: current.candidate,
        current,
        args: checked,
      },
      true,
    );
  } catch {
    return null;
  }
};
