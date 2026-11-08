import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ChatSelection } from "./chat-capabilities.ts";
import {
  ACCOUNTING_RECENT_ATTEMPTS,
  messageEffort,
  messageModelId,
  unknownAmount,
  type TitleResponse,
} from "./chat-accounting-model.ts";
import { amountOfUsage } from "./chat-accounting-amount.ts";
import { aggregateChatUsage } from "./chat-accounting-aggregate.ts";
import { ChatAccountingStore } from "./chat-accounting-store.ts";
import type { ChatSqlStorage } from "./chat-ledger.ts";
import type { ChatObjectMetadata } from "./chat-observation.ts";
import type { ChatUsage, ContextUsage, SpeechUsage } from "./chat-usage-schema.ts";

export type ChatAccountingSource = { readonly context: ContextUsage };
/** One ledger observes every actual provider callback, including SDK compaction. */
export class ChatAccounting {
  private readonly store: ChatAccountingStore;
  private readonly onRecorded: () => void;
  constructor(db: ChatSqlStorage, onRecorded: () => void, _metadata: ChatObjectMetadata = {}) {
    this.store = new ChatAccountingStore(db);
    this.onRecorded = onRecorded;
  }
  recordModel(
    key: string,
    operationId: string,
    kind: "generation" | "compaction",
    selection: ChatSelection,
    message: AssistantMessage | null,
  ): void {
    const actual = message === null ? null : messageModelId(message);
    this.store.record({
      attemptKey: `sdk:${key}`,
      kind: kind === "compaction" ? "summarization" : "generation",
      taskId: operationId,
      stopReason: message?.stopReason ?? null,
      model: actual ?? selection.model,
      effort: message === null ? selection.effort : (messageEffort(message) ?? selection.effort),
      amount:
        message === null ? unknownAmount() : amountOfUsage(message.usage, actual, selection.model),
      recordedAt: Date.now(),
    });
    this.onRecorded();
  }
  recordTitle(key: string, selection: ChatSelection, response: TitleResponse | null): void {
    const actual = response === null ? null : messageModelId(response);
    this.store.record({
      attemptKey: `title:${key}`,
      kind: "title",
      taskId: null,
      stopReason: response?.stopReason ?? null,
      model: actual ?? selection.model,
      effort: selection.effort,
      amount:
        response === null
          ? unknownAmount()
          : amountOfUsage(response.usage, actual, selection.model),
      recordedAt: Date.now(),
    });
    this.onRecorded();
  }
  recordSpeech(speech: SpeechUsage): void {
    this.store.recordSpeech(speech, Date.now());
    this.onRecorded();
  }
  usage(source: ChatAccountingSource): Promise<ChatUsage> {
    const lifetime = this.store.lifetime();
    return Promise.resolve(
      aggregateChatUsage({
        attempts: lifetime.attempts,
        titles: lifetime.titles,
        speech: lifetime.speech,
        recent: this.store.recentAttempts(ACCOUNTING_RECENT_ATTEMPTS),
        // There is no second native usage authority. Unknown claims remain Partial.
        nativeModels: {},
        context: source.context,
      }),
    );
  }
}
export { messageUsage } from "./chat-accounting-amount.ts";
