import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Message, RunRequest, Usage } from "@highchat/chat-runtime";

const zeroUsage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Placeholder assistant message used to close a stream whose response was cancelled. */
export const abortedMessage = (request: RunRequest): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: "highchat-transport",
  provider: request.selection.provider,
  model: request.selection.model,
  usage: zeroUsage,
  stopReason: "aborted",
  errorMessage: "Run stopped",
  timestamp: Date.now(),
});

/** Narrow an SDK agent message to the transcript values this wire carries. */
export const wireMessage = (message: AgentMessage): Message | undefined => {
  switch (message.role) {
    case "system":
    case "user":
    case "assistant":
    case "toolResult":
      return message;
    default:
      return undefined;
  }
};

export interface RunObserver {
  partial(message: AssistantMessage): void;
  message(message: Message): void;
}

/** Forward only the SDK events the run stream represents. */
export const observe = (event: AgentSessionEvent, observer: RunObserver): void => {
  switch (event.type) {
    case "message_update": {
      if (event.message.role === "assistant") observer.partial(event.message);
      return;
    }
    case "message_end": {
      const message = wireMessage(event.message);
      if (message !== undefined) observer.message(message);
      return;
    }
    default:
      return;
  }
};
