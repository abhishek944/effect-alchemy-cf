import { randomUUID } from "node:crypto";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AssistantMessageEvent,
  Message,
  RunEvent,
  RunRequest,
  ToolReply,
} from "@highchat/chat-runtime";
import type { ModelOpenInput, ModelSink, RunChannel, ToolCallInput } from "./channel.ts";
import { HostFailure, failureMessage } from "./errors.ts";
import { createModelSink } from "./model-sink.ts";
import { unansweredReason } from "./outcome.ts";
import { abortedMessage, observe } from "./observe.ts";
import { openSession } from "./session.ts";

/**
 * One accepted operation. It owns the in-memory SDK session, the open provider
 * streams and the pending tool calls, and it ends with exactly one settled event.
 */
export class Run implements RunChannel {
  readonly request: RunRequest;
  readonly #emit: (event: RunEvent) => void;
  readonly #models = new Map<string, ModelSink>();
  readonly #tools = new Map<string, (reply: ToolReply | undefined) => void>();
  #session: Awaited<ReturnType<typeof openSession>> | undefined;
  #final: AssistantMessage | undefined;
  #stopped = false;
  #channelLost = false;
  #settled = false;

  constructor(request: RunRequest, emit: (event: RunEvent) => void) {
    this.request = request;
    this.#emit = emit;
  }

  get isSettled(): boolean {
    return this.#settled;
  }

  isCompacting = (): boolean => this.#session?.session.isCompacting === true;

  emitPartial = (message: AssistantMessage): void => {
    if (!this.#settled) this.#emit({ type: "partial", message });
  };

  emitMessage = (message: Message): void => {
    if (message.role === "assistant") this.#final = message;
    if (!this.#settled) this.#emit({ type: "message", message });
  };

  openModel = (input: ModelOpenInput, signal: AbortSignal | undefined): ModelSink => {
    const requestId = randomUUID();
    const sink = createModelSink();
    this.#models.set(requestId, sink);
    this.#emit({
      type: "model",
      requestId,
      kind: input.kind,
      model: input.model,
      context: input.context,
      options: input.options,
    });
    signal?.addEventListener("abort", () => sink.fail(abortedMessage(this.request), "aborted"), {
      once: true,
    });
    if (this.#abandoned) sink.fail(abortedMessage(this.request), "aborted");
    return sink;
  };

  executeTool = async (
    input: ToolCallInput,
    signal: AbortSignal | undefined,
  ): Promise<ToolReply> => {
    if (this.#abandoned) throw new Error("run stopped");
    const requestId = randomUUID();
    const reply = await new Promise<ToolReply | undefined>((resolve) => {
      this.#tools.set(requestId, resolve);
      this.#emit({
        type: "tool",
        requestId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: input.input,
      });
      signal?.addEventListener("abort", () => this.#resolveTool(requestId, undefined), {
        once: true,
      });
    });
    if (reply === undefined) throw new Error("tool call cancelled");
    return reply;
  };

  /** Accept one provider stream event posted by the Worker. */
  pushModelEvent(requestId: string, event: AssistantMessageEvent): void {
    const sink = this.#models.get(requestId);
    if (sink === undefined) throw new HostFailure("stale_reply");
    if (!sink.push(event)) this.#models.delete(requestId);
  }

  replyTool(requestId: string, reply: ToolReply): void {
    if (!this.#tools.has(requestId)) throw new HostFailure("stale_reply");
    this.#resolveTool(requestId, reply);
  }

  /** Explicit Stop: abort this exact session and fail everything still waiting. */
  stop(): boolean {
    if (this.#settled) return false;
    this.#stopped = true;
    this.#failPending();
    void this.#session?.session.abort();
    return true;
  }

  /**
   * The run event stream itself was lost, so no provider turn or tool reply can
   * arrive again. Abort and fail the run instead of leaving it waiting forever;
   * nothing is retried and no paid work is repeated.
   */
  detach(): void {
    if (this.#settled || this.#channelLost) return;
    this.#channelLost = true;
    this.#failPending();
    void this.#session?.session.abort();
  }

  get #abandoned(): boolean {
    return this.#stopped || this.#channelLost;
  }

  async execute(): Promise<void> {
    try {
      if (this.#abandoned) {
        this.#settle();
        return;
      }
      const session = await openSession(this);
      this.#session = session;
      if (this.#abandoned) {
        await session.session.abort();
        this.#settle();
        return;
      }
      const observer = { partial: this.emitPartial, message: this.emitMessage };
      const off = session.session.subscribe((event) => observe(event, observer));
      try {
        await session.session.prompt(this.request.prompt, {
          images: this.request.images,
          expandPromptTemplates: false,
        });
      } finally {
        off();
      }
      this.#settle();
    } catch (error) {
      this.#settle(this.#abandoned ? undefined : failureMessage(error));
    } finally {
      this.#failPending();
      this.#session?.session.dispose();
    }
  }

  #settle(error?: string): void {
    if (this.#settled) return;
    this.#settled = true;
    if (this.#stopped) {
      // Only an explicit Stop reports "stopped"; a lost channel or model failure does not.
      this.#emit({ type: "settled", status: "stopped" });
      return;
    }
    const reason = this.#channelLost ? "Run channel lost" : unansweredReason(this.#final, error);
    this.#emit(
      reason === undefined
        ? { type: "settled", status: "answered" }
        : { type: "settled", status: "unanswered", error: reason },
    );
  }

  #resolveTool(requestId: string, reply: ToolReply | undefined): void {
    const waiter = this.#tools.get(requestId);
    if (waiter === undefined) return;
    this.#tools.delete(requestId);
    waiter(reply);
  }

  #failPending(): void {
    const aborted = abortedMessage(this.request);
    for (const sink of this.#models.values()) sink.fail(aborted, "aborted");
    this.#models.clear();
    for (const requestId of this.#tools.keys()) this.#resolveTool(requestId, undefined);
  }
}
