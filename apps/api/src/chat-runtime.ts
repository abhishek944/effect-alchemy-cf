import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { FailureContext } from "@highchat/diagnostics";
import type { ChatSelection } from "./chat-capabilities.ts";
import { INFERENCE_FAILURE } from "./chat-model.ts";
import type { ChatLedger } from "./chat-ledger.ts";
import type { ChatSendRecords } from "./chat-send-records.ts";
import type { AcceptedInputRecord } from "./chat-accepted-input-schema.ts";
import { acceptedPublicInput, publicInputEntry } from "./chat-input-projection.ts";
import type { ChatTranscript, StoredRun } from "./chat-transcript.ts";
import type { EntryId, PiContext, SubmissionRecord, ToolSlot } from "./chat-transcript-types.ts";

export const PI_BACKGROUND: PiContext = Object.freeze({
  abortSignal: undefined,
  value: () => undefined,
});
export type ActiveChatRun = {
  readonly record: StoredRun & { readonly entry: number };
  readonly controller: AbortController;
  readonly stopHost: () => Promise<boolean>;
  partial?: AssistantMessage | undefined;
  inputTimestamp?: number;
  stopRequested?: boolean;
  assistantEntry?: number;
  readonly tools: Map<string, ToolSlot>;
};

/** Object-owned state and exact-operation authority; all agent execution is remote. */
export class ChatRuntime {
  readonly transcript: ChatTranscript;
  readonly ledger: ChatLedger;
  readonly sends: ChatSendRecords;
  private readonly acceptedInput: (entry: number) => AcceptedInputRecord | null;
  private readonly listeners = new Set<() => void>();
  active: ActiveChatRun | null = null;
  diagnostic: Pick<FailureContext, "service" | "stage" | "release"> = {};
  constructor(
    transcript: ChatTranscript,
    ledger: ChatLedger,
    sends: ChatSendRecords,
    acceptedInput: (entry: number) => AcceptedInputRecord | null,
  ) {
    this.transcript = transcript;
    this.ledger = ledger;
    this.sends = sends;
    this.acceptedInput = acceptedInput;
  }
  subscribe(invalidate: () => void): () => void {
    this.listeners.add(invalidate);
    return () => {
      this.listeners.delete(invalidate);
    };
  }
  notify(): void {
    for (const listener of this.listeners) listener();
  }
  async conversation() {
    return this.transcript;
  }
  async conversationId() {
    return this.transcript.id;
  }
  async ensureRoot(_chatId?: string): Promise<void> {}
  async reconcile(_chatId?: string): Promise<void> {}
  async selection(): Promise<ChatSelection | null> {
    const last = this.transcript.latestRun();
    return last === null ? null : (this.sends.metadata(last.operationId)?.selection ?? null);
  }
  async publicInput(entry: number) {
    const user = this.sends.forEntry(entry);
    if (user !== null) return acceptedPublicInput(user, this.acceptedInput(entry));
    const operationId = this.transcript.entry(entry)?.operationId;
    return operationId === undefined
      ? null
      : {
          operationId,
          logicalOperationId: this.sends.logicalOperation(operationId),
          files: [],
          textLength: null,
          accepted: null,
        };
  }
  async entryFor(entryId: EntryId) {
    const entry = this.transcript.entry(entryId);
    return entry === undefined ? undefined : publicInputEntry(entry, this.sends);
  }
  async inputRecord(operationId: string): Promise<SubmissionRecord | undefined> {
    const run = this.transcript.run(operationId);
    if (run === null) return undefined;
    const base = {
      id: operationId,
      type: "input" as const,
      conversationId: this.transcript.id,
      requestId: operationId,
    };
    if (run.status === "unanswered" || run.status === "stopped")
      return {
        ...base,
        status: "unanswered",
        reason: run.status === "stopped" ? "aborted" : "model_error",
        ...(run.entry === null ? {} : { entry: run.entry }),
      };
    if (run.entry === null) throw new Error("An active/completed input has no transcript entry");
    return { ...base, status: run.status, entry: run.entry };
  }
  async receiptRecord(operationId: string) {
    return this.inputRecord(operationId);
  }
  async firstAcceptedInput(operationId: string): Promise<boolean> {
    const row = this.transcript.db
      .exec<{ operation_id: string }>(
        `SELECT operation_id FROM chat_sdk_runs ORDER BY rowid ASC LIMIT 1`,
      )
      .toArray()[0];
    return row?.operation_id === operationId;
  }
  async liveInput() {
    return { run: this.active !== null, operationId: this.active?.record.operationId ?? null };
  }
  async stop(operationId: string): Promise<boolean> {
    const active = this.active;
    if (active === null || active.record.operationId !== operationId) return false;
    // Immediately remove tool/provider authority before awaiting the exact host acknowledgement.
    active.stopRequested = true;
    active.controller.abort(new Error("Chat stop requested"));
    const stopped = await active.stopHost();
    if (stopped) {
      this.ledger.stopped(operationId, Date.now());
      this.transcript.saveRun({ ...active.record, status: "stopped" });
      this.notify();
    }
    return stopped;
  }
  finish(active: ActiveChatRun, status: "done" | "unanswered" | "stopped"): void {
    const current = this.transcript.run(active.record.operationId);
    if (current?.status === "stopped") status = "stopped";
    this.transcript.saveRun({ ...active.record, status });
    if (status === "stopped") this.ledger.stopped(active.record.operationId, Date.now());
    else this.ledger.setStatus(active.record.operationId, status, Date.now());
    if (this.active === active) this.active = null;
    this.notify();
  }
  async settlementError(_chatId: string): Promise<string | null> {
    const latest = this.transcript.latestRun();
    return latest?.status === "unanswered" && this.ledger.statusOf(latest.operationId) !== "stopped"
      ? INFERENCE_FAILURE
      : null;
  }
}
