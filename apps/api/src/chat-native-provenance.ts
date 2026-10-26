import { Schema } from "effect";
import {
  AssistantEntry,
  GenerationTask,
  LiveDoc,
  ToolTask,
  UserEntry,
  type EntryId,
  type Storage,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable";
import { AcceptedEntryId, AcceptedIndex } from "./chat-accepted-input-values.ts";
import type { AcceptedInputContext } from "./chat-accepted-input.ts";
import { decodeOption } from "./chat-internal.ts";

const SharedToolInput = Schema.Struct({ assistant: AcceptedEntryId, callId: Schema.String });
const Round = Schema.Struct({
  phase: Schema.Literal("tools"),
  assistant: AcceptedEntryId,
  tools: Schema.Array(AcceptedIndex),
});
const Execute = Schema.Struct({
  phase: Schema.Literal("execute"),
  replay: Schema.Literals(["safe", "unsafe"]),
  arguments: Schema.Unknown,
});
type ToolInput = { readonly assistant: EntryId; readonly callId: string };

/** Exact accepted native input, tool task, attempting generation and live slot. */
export type NativeProof = {
  readonly operationId: string;
  readonly submissionId: string;
  readonly toolTaskId: string;
  readonly generationTaskId: string;
  readonly assistantEntryId: string;
};
export type NativeLineageProof<A> = NativeProof & { readonly value: A | null };

/**
 * One version-matched traversal of SDK task/generation/round/call/assistant/live lineage.
 * Capability-specific call names and argument checks are parameters; running-tool, execute
 * checkpoint and live-slot-name checks stay selectable so weaker account lineage is unchanged.
 * Everything except the initial placement read runs inside one real `api.commit` transaction.
 */
export type NativeLineageOptions<A> = {
  readonly storage: Storage;
  readonly runningTool?: boolean;
  readonly readToolInput?: (raw: unknown) => ToolInput | null;
  readonly executeCheckpoint?: boolean;
  readonly callNames?: readonly string[];
  readonly liveSlotName?: boolean;
  readonly inspectArguments?: (input: {
    readonly callName: string;
    readonly arguments: unknown;
  }) => Promise<A> | A;
  readonly onDenied?: (reason: string) => void;
};

export const proveNativeLineage = async <A = null>(
  api: ToolExecutionApi,
  context: AcceptedInputContext,
  options: NativeLineageOptions<A>,
): Promise<NativeLineageProof<A> | null> => {
  const deny = (reason: string): null => {
    options.onDenied?.(reason);
    return null;
  };
  const live = await api.snapshot(LiveDoc, api.conversationId, context);
  const inputs = live?.run?.inputs ?? [];
  if (inputs.length !== 1) return deny("native-live-input-count");
  const submissionId = inputs[0];
  if (submissionId === undefined) return deny("native-live-input-missing");
  const native = await options.storage.submission(submissionId, context);
  if (native === undefined) return deny("native-submission-missing");
  if (native.type !== "input") return deny("native-submission-type");
  if (native.status !== "placed") return deny("native-submission-status");
  if (native.conversationId !== api.conversationId) return deny("native-submission-conversation");
  if (native.requestId === undefined) return deny("native-submission-request-missing");
  const operationId = native.requestId;
  let denial = "native-proof-result-missing";
  const reject = (reason: string): null => {
    denial = reason;
    return null;
  };
  const proof = await api.commit(async (tx) => {
    const tool = await tx.task(api.taskId);
    if (tool === undefined) return reject("tool-missing");
    if (tool.kind !== ToolTask.definition.name) return reject("tool-kind");
    if (tool.version !== ToolTask.definition.version) return reject("tool-version");
    if (tool.conversationId !== api.conversationId) return reject("tool-conversation");
    if (tool.abortRequested) return reject("tool-abort-requested");
    if (options.runningTool && tool.state.status !== "running") return reject("tool-status");
    const input =
      options.readToolInput === undefined
        ? decodeOption(SharedToolInput, tool.input)
        : options.readToolInput(tool.input);
    if (input === null) return reject("tool-input-invalid");
    if (input.callId !== api.callId) return reject("tool-call");
    if (tool.owner === undefined) return reject("tool-owner-missing");
    const generation = await tx.task(tool.owner);
    if (generation === undefined) return reject("generation-missing");
    if (generation.kind !== GenerationTask.definition.name) return reject("generation-kind");
    if (generation.version !== GenerationTask.definition.version)
      return reject("generation-version");
    if (generation.conversationId !== api.conversationId) return reject("generation-conversation");
    if (generation.abortRequested) return reject("generation-abort-requested");
    if (generation.state.status !== "waiting") return reject("generation-status");
    const round = decodeOption(Round, generation.state.checkpoint);
    if (round === null) return reject("round-checkpoint-invalid");
    if (round.assistant !== input.assistant) return reject("round-assistant");
    if (!round.tools.includes(api.taskId)) return reject("round-tool-missing");
    const execute =
      options.executeCheckpoint === false
        ? undefined
        : decodeOption(Execute, tool.state.checkpoint);
    if (options.executeCheckpoint !== false && execute === null)
      return reject("tool-checkpoint-invalid");
    const accepted = await tx.submissionByRequest(api.conversationId, operationId);
    if (accepted === undefined) return reject("accepted-submission-missing");
    if (accepted.id !== native.id) return reject("accepted-submission-id");
    if (accepted.type !== "input") return reject("accepted-submission-type");
    if (accepted.status !== "placed") return reject("accepted-submission-status");
    if (accepted.conversationId !== api.conversationId)
      return reject("accepted-submission-conversation");
    if (accepted.entry === undefined) return reject("accepted-entry-missing");
    const user = await tx.entry(UserEntry, accepted.entry);
    if (user === undefined) return reject("user-entry-missing");
    if (user.conversationId !== api.conversationId) return reject("user-entry-conversation");
    const assistant = await tx.entry(AssistantEntry, input.assistant);
    if (assistant === undefined) return reject("assistant-entry-missing");
    if (assistant.conversationId !== api.conversationId) return reject("assistant-conversation");
    if (assistant.byTaskId !== generation.id) return reject("assistant-generation");
    let callName: string | null = null;
    if (options.callNames !== undefined) {
      const message = assistant.model?.[0];
      if (message?.role !== "assistant") return reject("assistant-message-role");
      const calls = message.content
        .filter((block) => block.type === "toolCall")
        .filter((call) => call.id === api.callId);
      const call = calls[0];
      if (calls.length !== 1) return reject("call-count");
      if (call === undefined) return reject("call-missing");
      if (!options.callNames.includes(call.name)) return reject("call-tool-name");
      callName = call.name;
    }
    const liveNow = await tx.doc(LiveDoc, api.conversationId);
    if (liveNow?.run === undefined) return reject("live-run-missing");
    if (liveNow.run.taskId !== generation.id) return reject("live-generation");
    if (liveNow.run.inputs.length !== 1) return reject("live-input-count");
    if (liveNow.run.inputs[0] !== native.id) return reject("live-submission");
    const slot = (liveNow.tools ?? []).find((entry) => entry.taskId === api.taskId);
    if (slot === undefined) return reject("live-slot-missing");
    if (slot.callId !== api.callId) return reject("live-slot-call");
    if (options.liveSlotName && (slot.name !== callName || slot.status !== "running"))
      return reject("live-slot-status");
    const value =
      callName !== null && options.inspectArguments !== undefined
        ? await options.inspectArguments({
            callName,
            arguments: execute === null ? undefined : execute?.arguments,
          })
        : null;
    if (callName !== null && options.inspectArguments !== undefined && value === null)
      return reject("argument-check");
    return {
      operationId,
      submissionId: String(native.id),
      toolTaskId: String(api.taskId),
      generationTaskId: String(generation.id),
      assistantEntryId: String(input.assistant),
      value,
    };
  }, context);
  return proof ?? deny(denial);
};
