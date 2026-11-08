import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { AssistantMessageEvent } from "@highchat/chat-runtime";
import type { ModelSink } from "./channel.ts";

/**
 * Bridges one SDK provider stream to Worker-posted events. The first terminal
 * event ends the stream; anything after it is rejected rather than reopening a
 * response the SDK already consumed.
 */
export const createModelSink = (): ModelSink => {
  const stream: AssistantMessageEventStream = createAssistantMessageEventStream();
  let finished = false;
  const finish = (event: AssistantMessageEvent, result: AssistantMessage): boolean => {
    if (finished) return false;
    finished = true;
    stream.push(event);
    stream.end(result);
    return true;
  };
  return {
    stream,
    push: (event) => {
      if (finished) return false;
      if (event.type === "done") return finish(event, event.message);
      if (event.type === "error") return finish(event, event.error);
      stream.push(event);
      return true;
    },
    fail: (error, reason) => {
      finish({ type: "error", reason, error }, error);
    },
  };
};
