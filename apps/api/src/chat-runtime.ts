import { reportFailure, type FailureContext } from "@starter/diagnostics";
import {
  LiveDoc,
  ROOT_CONVERSATION_ID,
  type Conversation,
  type ConversationId,
  type EntryId,
  type EntryRecord,
  type Harness,
  type SubmissionId,
  type SubmissionRecord,
} from "@earendil-works/pi-durable";
import { ROOT_SESSION, type PiHarness } from "agents/harness/pi";
import type { ChatLedger } from "./chat-ledger.ts";
import { reportSettlement } from "./chat-observation.ts";
import { INFERENCE_FAILURE } from "./chat-model.ts";
import { ChatSelection } from "./chat-capabilities.ts";
import { decodeOption } from "./chat-internal.ts";
import type { ChatSendRecords } from "./chat-send-records.ts";
import { publicInputEntry } from "./chat-input-projection.ts";
import type { PiContext } from "./chat-projection.ts";
import { ChatStop } from "./chat-stop.ts";
export const PI_BACKGROUND: PiContext = Object.freeze({
  abortSignal: undefined,
  value: () => undefined,
  toString: () => "[chat conversation background]",
});
type ChatStorage = Awaited<ReturnType<PiHarness["storage"]>>;
export class ChatRuntime {
  private readonly harness: PiHarness;
  private readonly ledger: ChatLedger;
  private readonly sends: ChatSendRecords;
  private readonly operationCache = new Map<string, string>();
  private repaired = false;
  private readonly stops: ChatStop;
  /** Safe composition-supplied labels; never request identity or authority. */
  diagnostic: Pick<FailureContext, "service" | "stage" | "release"> = {};
  constructor(harness: PiHarness, ledger: ChatLedger, sends: ChatSendRecords) {
    this.harness = harness;
    this.ledger = ledger;
    this.sends = sends;
    this.stops = new ChatStop(this, ledger);
  }
  async pi(): Promise<Harness> {
    return this.harness.pi();
  }
  async conversation(): Promise<Conversation> {
    return this.harness.conversation(ROOT_SESSION);
  }
  async storage(): Promise<ChatStorage> {
    return this.harness.storage();
  }
  async publicInput(entryId: number) {
    return this.sends.forEntry(entryId);
  }
  async selection() {
    const agent = await (await this.conversation()).agent(PI_BACKGROUND);
    return decodeOption(ChatSelection, {
      provider: agent.model?.provider,
      model: agent.model?.modelId,
      effort: agent.thinkingLevel,
    });
  }
  async conversationId(): Promise<ConversationId> {
    return (await this.conversation()).id;
  }
  async entryFor(entryId: EntryId): Promise<EntryRecord | undefined> {
    const storage = await this.storage();
    const entry = (await storage.entry(ROOT_CONVERSATION_ID, entryId, PI_BACKGROUND))?.entry;
    return entry === undefined ? undefined : publicInputEntry(entry, this.sends);
  }
  async inputRecord(
    operationId: string,
  ): Promise<Extract<SubmissionRecord, { type: "input" }> | undefined> {
    const storage = await this.storage();
    const record = await storage.submissionByRequest(
      ROOT_CONVERSATION_ID,
      operationId,
      PI_BACKGROUND,
    );
    return record?.type === "input" && record.requestId === operationId ? record : undefined;
  }
  async liveInput(): Promise<{ readonly run: boolean; readonly operationId: string | null }> {
    const pi = await this.pi();
    const id = await this.conversationId();
    const native = await pi.snapshot(LiveDoc, id, PI_BACKGROUND);
    const run = native?.run;
    if (run === undefined) return { run: false, operationId: null };
    const input = run.inputs[0];
    if (input === undefined) return { run: true, operationId: null };
    return { run: true, operationId: await this.operationIdOf(input) };
  }
  async firstAcceptedInput(operationId: string): Promise<boolean> {
    if ((await this.inputRecord(operationId)) === undefined) return false;
    const storage = await this.storage();
    const query = { conversationId: ROOT_CONVERSATION_ID, order: "ascending" } as const;
    const page = await storage.scanSubmissions(query, 16, undefined, PI_BACKGROUND);
    return page.items.find((item) => item.type === "input")?.requestId === operationId;
  }
  async receiptRecord(operationId: string): Promise<SubmissionRecord | undefined> {
    await this.stops.settled(operationId);
    const record = await this.inputRecord(operationId);
    await this.stops.settled(operationId);
    return record;
  }
  stop(operationId: string): Promise<boolean> {
    return this.stops.stop(operationId);
  }
  async ensureRoot(chatId?: string): Promise<void> {
    if (this.repaired) return;
    try {
      const conversation = await this.conversation();
      const agent = await conversation.agent(PI_BACKGROUND);
      const configured = agent.model?.provider !== undefined && agent.model.modelId !== undefined;
      if (!configured) {
        if (await this.harness.session(ROOT_SESSION).busy()) return;
        await conversation.configure(this.harness.agentDefaults(), PI_BACKGROUND);
      }
      this.repaired = true;
    } catch (error) {
      // Best-effort initialization: report without claiming the root was repaired.
      reportFailure(error, {
        ...this.diagnostic,
        component: "chat-runtime",
        operation: "ensure-root",
        chatId,
        event: "application.recovery",
      });
    }
  }
  async reconcile(chatId?: string): Promise<void> {
    const page = this.ledger.unmappedPage(6);
    if (page.length === 0) return;
    try {
      const storage = await this.storage();
      for (const row of page) {
        const record = await storage.submissionByRequest(
          ROOT_CONVERSATION_ID,
          row.operationId,
          PI_BACKGROUND,
        );
        if (record !== undefined && "entry" in record && record.entry !== undefined) {
          this.ledger.recordEntry(row.operationId, record.entry, Date.now());
        }
      }
      this.ledger.advance(page.at(-1)?.rowid ?? 0);
    } catch (error) {
      // Ledger repair is best effort; a failed read must not look like a mapped page.
      reportFailure(error, {
        ...this.diagnostic,
        component: "chat-runtime",
        operation: "ledger-reconcile",
        chatId,
        event: "application.recovery",
      });
    }
  }
  private async submissionRecord(id: SubmissionId): Promise<SubmissionRecord | null> {
    const pi = await this.pi();
    const submission = await pi.submission(id, PI_BACKGROUND);
    if (submission === undefined) return null;
    return await submission.status(PI_BACKGROUND);
  }
  async operationIdOf(submission: SubmissionId): Promise<string | null> {
    const key = String(submission);
    const cached = this.operationCache.get(key);
    if (cached !== undefined) return cached;
    const record = await this.submissionRecord(submission);
    if (record === null || record.requestId === undefined) return null;
    if (this.operationCache.size >= 128) this.operationCache.clear();
    this.operationCache.set(key, record.requestId);
    this.ledger.recordEntry(
      record.requestId,
      "entry" in record ? record.entry : undefined,
      Date.now(),
    );
    return record.requestId;
  }
  async settlementError(chatId: string): Promise<string | null> {
    const latest = this.ledger.latest();
    if (latest === null) return null;
    const record = await this.receiptRecord(latest.operationId);
    if (record === undefined) return null; // Absence is unconfirmed, never synthetic not_found.
    const previous = this.ledger.statusOf(latest.operationId);
    if (previous === "stopped") return null;
    if (record.status === "queued" || record.status === "placed") {
      this.ledger.accepted(latest.operationId, Date.now());
      return null;
    }
    this.ledger.setStatus(latest.operationId, record.status, Date.now());
    if (record.status === "unanswered" && previous !== "unanswered")
      reportSettlement(record, { operationId: latest.operationId, chatId }, this.diagnostic);
    return record.status === "unanswered" ? INFERENCE_FAILURE : null;
  }
}
