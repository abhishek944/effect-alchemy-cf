/**
 * The native lineage proof for one executing account tool.
 *
 * Runs inside a single `api.commit` transaction and only reads: the tool task, its
 * owner generation waiting on this tool round, the assistant entry attributed to
 * that generation, the placed native input submission resolved by request id, and
 * the live run/doc that ties them together. Any missing or mismatched step returns
 * null, so account mutation fails closed instead of guessing from transcript text.
 */
import { Schema } from "effect";
import type { EntryId, Storage, ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  AssistantEntry,
  GenerationTask,
  LiveDoc,
  ToolTask,
  UserEntry,
} from "@earendil-works/pi-durable";
import { decodeOption } from "./chat-internal.ts";
import type { ToolContext } from "./chat-account-resolver.ts";

/**
 * Trusted numeric decoding boundary for entry ids: the brand is erased at runtime,
 * so the only check that can exist is the numeric shape itself. This mirrors the
 * SDK's own id-from-number decoding boundary instead of asserting a fabricated id.
 */
const EntryIdValue = Schema.declare<EntryId>(
  (input): input is EntryId =>
    typeof input === "number" && Number.isSafeInteger(input) && input >= 0,
  { title: "EntryId" },
);
const ToolTaskInputSchema = Schema.Struct({
  assistant: EntryIdValue,
  callId: Schema.String,
});
const ToolsCheckpointSchema = Schema.Struct({
  phase: Schema.Literal("tools"),
  assistant: EntryIdValue,
  tools: Schema.Array(
    Schema.Number.check(Schema.makeFilter((id) => Number.isSafeInteger(id) && id >= 0)),
  ),
});

export type NativeProof = {
  readonly operationId: string;
  readonly submissionId: string;
  readonly toolTaskId: string;
  readonly generationTaskId: string;
  readonly assistantEntryId: string;
};

export const proveNativeInput = async (
  api: ToolExecutionApi,
  context: ToolContext,
  storage: Storage,
): Promise<NativeProof | null> => {
  const live = await api.snapshot(LiveDoc, api.conversationId, context);
  const inputs = live?.run?.inputs ?? [];
  if (inputs.length !== 1) return null;
  const submissionId = inputs[0];
  if (submissionId === undefined) return null;
  const native = await storage.submission(submissionId, context);
  if (
    native === undefined ||
    native.type !== "input" ||
    native.status !== "placed" ||
    native.conversationId !== api.conversationId ||
    native.requestId === undefined
  )
    return null;
  const operationId = native.requestId;
  const proof = await api.commit(async (tx) => {
    const tool = await tx.task(api.taskId);
    if (
      tool === undefined ||
      tool.kind !== ToolTask.definition.name ||
      tool.version !== ToolTask.definition.version
    )
      return null;
    if (tool.conversationId !== api.conversationId || tool.abortRequested) return null;
    const toolInput = decodeOption(ToolTaskInputSchema, tool.input);
    if (toolInput === null || toolInput.callId !== api.callId || tool.owner === undefined)
      return null;
    const generation = await tx.task(tool.owner);
    if (
      generation === undefined ||
      generation.kind !== GenerationTask.definition.name ||
      generation.version !== GenerationTask.definition.version ||
      generation.conversationId !== api.conversationId ||
      generation.abortRequested ||
      generation.state.status !== "waiting"
    )
      return null;
    const checkpoint = decodeOption(ToolsCheckpointSchema, generation.state.checkpoint);
    if (
      checkpoint === null ||
      String(checkpoint.assistant) !== String(toolInput.assistant) ||
      !checkpoint.tools.includes(api.taskId)
    )
      return null;
    const accepted = await tx.submissionByRequest(api.conversationId, operationId);
    if (
      accepted === undefined ||
      accepted.id !== native.id ||
      accepted.type !== "input" ||
      accepted.status !== "placed" ||
      accepted.conversationId !== api.conversationId ||
      accepted.entry === undefined
    )
      return null;
    const user = await tx.entry(UserEntry, accepted.entry);
    if (user === undefined || user.conversationId !== api.conversationId) return null;
    const assistant = await tx.entry(AssistantEntry, toolInput.assistant);
    if (
      assistant === undefined ||
      assistant.conversationId !== api.conversationId ||
      assistant.byTaskId !== generation.id
    )
      return null;
    const liveNow = await tx.doc(LiveDoc, api.conversationId);
    if (
      liveNow?.run === undefined ||
      String(liveNow.run.taskId) !== String(generation.id) ||
      liveNow.run.inputs.length !== 1 ||
      liveNow.run.inputs[0] !== native.id
    )
      return null;
    const slot = (liveNow.tools ?? []).find((entry) => entry.taskId === api.taskId);
    if (slot === undefined || slot.callId !== api.callId) return null;
    return {
      operationId,
      submissionId: String(native.id),
      toolTaskId: String(api.taskId),
      generationTaskId: String(generation.id),
      assistantEntryId: String(toolInput.assistant),
    };
  }, context);
  return proof ?? null;
};
