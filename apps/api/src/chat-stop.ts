import { LiveDoc, ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import type { ChatLedger } from "./chat-ledger.ts";
import { PI_BACKGROUND, type ChatRuntime } from "./chat-runtime.ts";

/** Bounded provenance gate only; native Pi continues to own cancellation/execution. */
export class ChatStop {
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly runtime: ChatRuntime;
  private readonly ledger: ChatLedger;
  constructor(runtime: ChatRuntime, ledger: ChatLedger) {
    this.runtime = runtime;
    this.ledger = ledger;
  }
  stop(operationId: string): Promise<boolean> {
    const known = this.pending.get(operationId);
    if (known !== undefined) return known;
    if (this.pending.size >= 1) return Promise.reject(new Error("Stop already in progress"));
    const task = this.perform(operationId).finally(() => {
      this.pending.delete(operationId);
    });
    this.pending.set(operationId, task);
    return task;
  }
  /** Readers wait for exact Stop proof rather than publishing an intermediate unanswered error. */
  async settled(operationId: string): Promise<void> {
    const pending = this.pending.get(operationId);
    if (pending === undefined) return;
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("Stop confirmation pending")), 500);
      pending.then(
        () => {
          clearTimeout(deadline);
          resolve();
          return undefined;
        },
        (error: unknown) => {
          clearTimeout(deadline);
          reject(error);
          return undefined;
        },
      );
    });
  }
  private async perform(operationId: string): Promise<boolean> {
    const record = await this.runtime.inputRecord(operationId);
    if (record === undefined || record.status === "done" || record.status === "unanswered")
      return false;
    this.ledger.tentative(operationId, Date.now());
    this.ledger.accepted(operationId, Date.now());
    const pi = await this.runtime.pi();
    // The immutable task ID is selected only from a run containing this exact native input.
    const markRun = async (): Promise<boolean> => {
      const live = await pi.snapshot(LiveDoc, ROOT_CONVERSATION_ID, PI_BACKGROUND);
      if (live?.run === undefined || !live.run.inputs.includes(record.id)) return false;
      return (await pi.abortTask(live.run.taskId, PI_BACKGROUND)) === "marked";
    };
    let marked = false;
    if (record.status === "placed") marked = await markRun();
    if (!marked) {
      const result = await pi.abortSubmission(record.id, PI_BACKGROUND, ROOT_CONVERSATION_ID);
      marked = result === "aborted" || (result === "already_placed" && (await markRun()));
    }
    // A verified mark/withdrawal may race terminal reconciliation; it may override unanswered,
    // never a false/terminal/no-op/failed native request. No conversation-wide abort is used.
    if (marked) this.ledger.stopped(operationId, Date.now());
    return marked;
  }
}
