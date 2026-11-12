import type { Context, Models } from "@earendil-works/pi-ai";
import type { ModelRequestEvent, ToolRequestEvent } from "@highchat/chat-runtime";
import { reportFailure } from "@highchat/diagnostics";
import type { ChatSdkHost } from "./chat-sdk-host.ts";
import { type ActiveChatRun, type ChatRuntime } from "./chat-runtime.ts";
import type { ChatSendScope } from "./chat-submission.ts";
import type { SendMessage } from "./chat-model.ts";
import type { ChatAccounting } from "./chat-accounting.ts";
import type { ChatSdkTool, ChatToolScope } from "./chat-sdk-tool.ts";
import { SkillRunFatalError } from "./chat-sdk-skills-fatal.ts";
import { sdkModelReply } from "./chat-sdk-model.ts";

export type SdkExecutionOptions = {
  readonly runtime: ChatRuntime;
  readonly host: ChatSdkHost;
  readonly models: Models;
  readonly identity: { readonly userId: string; readonly sessionId: string };
  readonly accounting: ChatAccounting;
  readonly tools: readonly ChatSdkTool[];
  readonly chatScope: () => string;
  readonly waitUntil: (promise: Promise<void>) => void;
  readonly hydrate: (
    context: Context,
    input: typeof SendMessage.Type,
    active: ActiveChatRun,
  ) => Promise<Context>;
};
const jsonIdentity = (value: unknown): string | undefined =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b)))
      : item,
  );

export const assertSdkRunLive = (runtime: ChatRuntime, active: ActiveChatRun): void => {
  active.controller.signal.throwIfAborted();
  if (runtime.active !== active) throw new Error("This run no longer owns execution authority");
};
export const dispatchSdkTool = async (
  options: SdkExecutionOptions,
  event: ToolRequestEvent,
  active: ActiveChatRun,
  scope: ChatSendScope,
  tools: readonly ChatSdkTool[],
  called: Set<string>,
): Promise<void> => {
  assertSdkRunLive(options.runtime, active);
  const assistant = active.assistantEntry;
  const message =
    assistant === undefined ? undefined : options.runtime.transcript.entry(assistant)?.model?.[0];
  const call =
    message?.role === "assistant"
      ? message.content.find(
          (block) =>
            block.type === "toolCall" &&
            block.id === event.toolCallId &&
            block.name === event.toolName,
        )
      : undefined;
  const descriptor = tools.find((tool) => tool.name === event.toolName);
  const key = `${assistant}:${event.toolCallId}`;
  if (
    assistant === undefined ||
    call?.type !== "toolCall" ||
    descriptor === undefined ||
    called.has(key) ||
    jsonIdentity(call.arguments) !== jsonIdentity(event.input)
  )
    throw new Error("Tool request does not match its accepted assistant call");
  called.add(key);
  active.tools.set(event.toolCallId, {
    callId: event.toolCallId,
    name: event.toolName,
    status: "running",
  });
  options.runtime.notify();
  const toolScope: ChatToolScope = {
    operationId: active.record.operationId,
    ownerId: scope.ownerId,
    chatId: scope.chat.id,
    chatScope: options.chatScope(),
    conversationId: String(options.runtime.transcript.id),
    callId: event.toolCallId,
    assistantEntry: assistant,
    signal: active.controller.signal,
  };
  let result;
  try {
    result = await descriptor.execute(event.input, toolScope);
  } catch (error) {
    if (error instanceof SkillRunFatalError || active.controller.signal.aborted) throw error;
    reportFailure(error, {
      ...options.runtime.diagnostic,
      component: "chat-sdk",
      operation: "tool",
      operationId: active.record.operationId,
    });
    result = {
      content: [
        {
          type: "text" as const,
          text: "This tool could not complete. Its outcome is unconfirmed; do not claim success or retry paid work automatically.",
        },
      ],
      details: null,
      isError: true,
    };
  }
  assertSdkRunLive(options.runtime, active);
  await options.host.reply(
    active.record.runId,
    event.requestId,
    JSON.stringify(result),
    "tool",
    active.controller.signal,
  );
  if (active.assistantEntry === assistant)
    active.tools.set(event.toolCallId, {
      callId: event.toolCallId,
      name: event.toolName,
      status: "done",
    });
  options.runtime.notify();
};
export const dispatchSdkModel = async (
  options: SdkExecutionOptions,
  event: ModelRequestEvent,
  active: ActiveChatRun,
  input: typeof SendMessage.Type,
): Promise<void> => {
  assertSdkRunLive(options.runtime, active);
  const context = await options.hydrate(event.context, input, active);
  assertSdkRunLive(options.runtime, active);
  const body = sdkModelReply({
    models: options.models,
    customer: options.identity.userId,
    request: event,
    context,
    selection: input.selection,
    runId: active.record.runId,
    operationId: input.operationId,
    accounting: options.accounting,
    signal: active.controller.signal,
  });
  await options.host.reply(
    active.record.runId,
    event.requestId,
    body,
    "model",
    active.controller.signal,
  );
};
