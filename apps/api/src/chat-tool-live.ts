import { Schema } from "effect";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { projectPublicTools } from "./chat-tool-projection.ts";
import {
  GenerationTask,
  type ConversationId,
  type Harness,
  type LiveState,
} from "@earendil-works/pi-durable";
import { decodeOption } from "./chat-internal.ts";
import { isEntryId } from "./chat-text.ts";
import type { LiveToolRound } from "./chat-tool-history.ts";

export const partialToolPreview = (message: AssistantMessage | undefined) =>
  message === undefined
    ? { tools: [], toolsTruncated: false, visited: 0 }
    : projectPublicTools(message, new Map(), 32, undefined, [], false, true);
const RoundCheckpoint = Schema.Struct({
  phase: Schema.Literal("tools"),
  assistant: Schema.Number.check(Schema.makeFilter(isEntryId)),
});
/** Live slots alone have reusable call IDs; their run task pins the actual assistant round. */
export const liveToolRound = async (
  pi: Harness,
  native: LiveState | undefined,
  conversation: ConversationId,
  context: Parameters<Harness["getTask"]>[1],
): Promise<LiveToolRound | undefined> => {
  if (native?.run === undefined || native.tools === undefined) return undefined;
  const task = await pi.getTask(native.run.taskId, context);
  if (
    task === undefined ||
    task.kind !== GenerationTask.definition.name ||
    task.version !== GenerationTask.definition.version ||
    task.conversationId !== conversation ||
    task.state.status === "terminal" ||
    task.state.status === "completing"
  )
    return undefined;
  const checkpoint = decodeOption(RoundCheckpoint, task.state.checkpoint);
  if (checkpoint === null || !isEntryId(checkpoint.assistant)) return undefined;
  return { assistant: checkpoint.assistant, slots: native.tools };
};
