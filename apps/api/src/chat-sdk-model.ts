import type { Context, Models } from "@earendil-works/pi-ai";
import type { ModelRequestEvent } from "@highchat/chat-runtime";
import { effectiveGenerationOutputTokens } from "./chat-generation-output-budget.ts";
import type { ChatSelection } from "./chat-capabilities.ts";
import type { ChatAccounting } from "./chat-accounting.ts";

/** Streaming provider transport only. The Pi SDK session and tool loop run in Node. */
export const sdkModelReply = (input: {
  readonly models: Models;
  readonly request: ModelRequestEvent;
  readonly context: Context;
  readonly selection: ChatSelection;
  readonly runId: string;
  readonly operationId: string;
  readonly accounting: ChatAccounting;
  readonly signal: AbortSignal;
}): ReadableStream<Uint8Array> => {
  const model = input.models.getModel(input.selection.provider, input.selection.model);
  if (model === undefined) throw new Error("The selected model is unavailable");
  const maxTokens = effectiveGenerationOutputTokens(
    model.contextWindow,
    model.maxTokens,
    input.context,
    input.request.options.maxTokens,
  );
  input.accounting.recordModel(
    `${input.runId}:${input.request.requestId}`,
    input.operationId,
    input.request.kind,
    input.selection,
    null,
  );
  const stream = input.models.streamSimple(model, input.context, {
    ...input.request.options,
    maxTokens,
    signal: input.signal,
  });
  const iterator = stream[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  let terminal = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        input.signal.throwIfAborted();
        const item = await iterator.next();
        if (item.done) {
          if (!terminal) throw new Error("Provider ended without a terminal response");
          controller.close();
          return;
        }
        const event = item.value;
        if (event.type === "done" || event.type === "error") {
          terminal = true;
          const message = event.type === "done" ? event.message : event.error;
          input.accounting.recordModel(
            `${input.runId}:${input.request.requestId}`,
            input.operationId,
            input.request.kind,
            input.selection,
            message,
          );
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
};
