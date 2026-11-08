import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  ModelDescriptor,
  ModelRequestKind,
  ProviderThinkingLevel,
  RunRequest,
  ToolReply,
} from "@highchat/chat-runtime";

/** One in-flight tool call the Worker must execute. */
export interface ToolCallInput {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
}

/** One provider turn the Worker must stream back. */
export interface ModelOpenInput {
  readonly kind: ModelRequestKind;
  readonly model: ModelDescriptor;
  readonly context: Context;
  readonly options: {
    readonly reasoning?: ProviderThinkingLevel;
    readonly maxTokens?: number;
  };
}

/**
 * One SDK provider stream fed by Worker-posted events. `push` returns false once
 * the stream is finished, so a late event cannot reopen a settled response.
 */
export interface ModelSink {
  readonly stream: AssistantMessageEventStream;
  push(event: AssistantMessageEvent): boolean;
  fail(error: AssistantMessage, reason: "aborted" | "error"): void;
}

/**
 * Lets an SDK extension reach the Worker mid-run. Implemented by the run itself,
 * so every callback can be failed once the owning run stops accepting work.
 */
export interface RunChannel {
  readonly request: RunRequest;
  /** True while the SDK is summarizing context rather than answering the prompt. */
  readonly isCompacting: () => boolean;
  emitPartial(message: AssistantMessage): void;
  emitMessage(message: Message): void;
  /** Registers the reply route, publishes the model event, and returns the SDK stream. */
  openModel(input: ModelOpenInput, signal: AbortSignal | undefined): ModelSink;
  executeTool(input: ToolCallInput, signal: AbortSignal | undefined): Promise<ToolReply>;
}
