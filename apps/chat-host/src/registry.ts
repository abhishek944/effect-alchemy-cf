import type { AssistantMessageEvent, RunEvent, ToolReply } from "@highchat/chat-runtime";
import type { Run } from "./run.ts";
import { HostFailure } from "./errors.ts";

/** Active runs by caller-issued id. Durable dedupe stays with the Worker. */
export class RunRegistry {
  readonly #runs = new Map<string, Run>();

  start(run: Run): Run {
    if (this.#runs.has(run.request.runId)) {
      throw new HostFailure("run_active", "a run with this id is already active");
    }
    this.#runs.set(run.request.runId, run);
    return run;
  }

  finish(runId: string): void {
    this.#runs.delete(runId);
  }

  stop(runId: string): boolean {
    return this.#owned(runId).stop();
  }

  pushModelEvent(runId: string, requestId: string, event: AssistantMessageEvent): void {
    this.#owned(runId).pushModelEvent(requestId, event);
  }

  replyTool(runId: string, requestId: string, reply: ToolReply): void {
    this.#owned(runId).replyTool(requestId, reply);
  }

  #owned(runId: string): Run {
    const run = this.#runs.get(runId);
    if (run === undefined) throw new HostFailure("run_unknown", "no active run with this id");
    return run;
  }
}

export type { RunEvent };
