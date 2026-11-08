import { RunEvent, ChatHostPaths, NdjsonMediaType, ndjsonLines } from "@highchat/chat-runtime";
import type { RunRequest } from "@highchat/chat-runtime";
import { Schema } from "effect";

const StopReply = Schema.Struct({ runId: Schema.String, stopped: Schema.Boolean });
export type ChatHostConfiguration = {
  readonly CHAT_HOST_URL?: string;
  readonly CHAT_HOST_TOKEN?: string;
};

export class ChatSdkHost {
  private readonly base: URL;
  private readonly token: string;
  constructor(env: ChatHostConfiguration) {
    if (!env.CHAT_HOST_URL || !env.CHAT_HOST_TOKEN)
      throw new Error("The Pi host is not configured");
    this.base = new URL(env.CHAT_HOST_URL);
    const local =
      this.base.hostname === "127.0.0.1" ||
      this.base.hostname === "localhost" ||
      this.base.hostname === "[::1]";
    if (
      (this.base.protocol !== "https:" && !(local && this.base.protocol === "http:")) ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      this.base.pathname !== "/"
    )
      throw new Error("Invalid Pi host URL");
    this.token = env.CHAT_HOST_TOKEN;
  }
  private headers(contentType: string) {
    return { authorization: `Bearer ${this.token}`, "content-type": contentType };
  }
  async run(
    request: RunRequest,
    event: (event: typeof RunEvent.Type) => void,
    accepted: () => void,
  ): Promise<void> {
    const response = await fetch(new URL(ChatHostPaths.runs, this.base), {
      method: "POST",
      headers: { ...this.headers("application/json"), accept: NdjsonMediaType },
      body: JSON.stringify(request),
    });
    if (!response.ok || response.body === null) {
      await response.body?.cancel();
      throw new Error(`Pi host rejected run (${response.status})`);
    }
    accepted();
    let settled = false;
    for await (const value of ndjsonLines(response.body)) {
      if (settled) throw new Error("Pi host emitted after settlement");
      const decoded = Schema.decodeUnknownSync(RunEvent)(value);
      event(decoded);
      settled = decoded.type === "settled";
    }
    if (!settled) throw new Error("Pi host disconnected before settlement");
  }
  async reply(
    runId: string,
    requestId: string,
    body: string | ReadableStream<Uint8Array>,
    kind: "tool" | "model",
    signal: AbortSignal,
  ): Promise<void> {
    // Node's fetch (Undici) rejects a streamed request body unless `duplex` is set.
    const init: RequestInit & { duplex?: "half" } = {
      method: "POST",
      headers: this.headers(kind === "model" ? NdjsonMediaType : "application/json"),
      body,
      signal,
      ...(typeof body === "string" ? {} : { duplex: "half" as const }),
    };
    const response = await fetch(
      new URL(ChatHostPaths.runReply(runId, requestId), this.base),
      init,
    );
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Pi host rejected reply (${response.status})`);
  }
  async stop(runId: string): Promise<boolean> {
    const response = await fetch(new URL(ChatHostPaths.runStop(runId), this.base), {
      method: "POST",
      headers: this.headers("application/json"),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Pi stop could not be confirmed");
    }
    const value: unknown = await response.json();
    const reply = Schema.decodeUnknownSync(StopReply)(value);
    if (reply.runId !== runId) throw new Error("Pi stop identity mismatch");
    return reply.stopped;
  }
}
