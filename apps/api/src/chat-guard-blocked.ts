/** Terminal zero-usage blocked results for the mandatory Models boundary. */
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
} from "@earendil-works/pi-ai";

export const blocked = (model: Model<Api>, message: string): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: model.api,
  provider: model.provider,
  model: model.id,
  timestamp: Date.now(),
  stopReason: "aborted",
  errorMessage: message,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});

export const blockedStream = (model: Model<Api>, message: string) => {
  const result = blocked(model, message);
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "error", reason: "aborted", error: result });
  stream.end(result);
  return stream;
};
