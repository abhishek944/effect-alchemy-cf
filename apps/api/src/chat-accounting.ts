/**
 * T27 accounting facade: one durable, per-conversation ledger, a Pi extension
 * that observes native generation responses, and the exact compaction seam.
 * The parent constructs it inside `ChatConversation`, wraps its freshly created
 * Models registry with `observeCompactions`, installs the extension, forwards
 * external title/speech actuals, and reads `usage()` for the authenticated chat
 * usage endpoint. Nothing here edits the transcript or calls a provider. Native
 * observer failures are swallowed so accepted native output is never broken;
 * explicit external title/speech writes propagate storage failures instead of
 * pretending success.
 */
import type { Models } from "@earendil-works/pi-ai/models";
import {
  defineExtension,
  GenerationTask,
  hook,
  type Extension,
  type UsageState,
} from "@earendil-works/pi-durable";
import type { ChatSelection } from "./chat-capabilities.ts";
import {
  ACCOUNTING_EXTENSION_NAME,
  ACCOUNTING_RECENT_ATTEMPTS,
  messageEffort,
  messageModelId,
  unknownAmount,
  type TitleResponse,
} from "./chat-accounting-model.ts";
import { amountOfUsage } from "./chat-accounting-amount.ts";
import { aggregateChatUsage } from "./chat-accounting-aggregate.ts";
import { installCompactionObserver } from "./chat-accounting-compaction-observer.ts";
import { ChatAccountingStore } from "./chat-accounting-store.ts";
import type { ChatSqlStorage } from "./chat-ledger.ts";
import type { ChatUsage, ContextUsage, SpeechUsage } from "./chat-usage-schema.ts";

/** Everything `usage()` needs from the native conversation, already read by the parent. */
export type ChatAccountingSource = {
  readonly context: ContextUsage;
  readonly nativeUsage: Readonly<UsageState> | null;
};

/** Models instances already wrapped, so the seam is installed exactly once. */
const observedModels = new WeakSet<object>();

export class ChatAccounting {
  private readonly store: ChatAccountingStore;
  private readonly onRecorded: () => void;

  constructor(db: ChatSqlStorage, onRecorded: () => void) {
    this.store = new ChatAccountingStore(db);
    this.onRecorded = onRecorded;
  }

  /**
   * Notifies the host after a persisted write so live viewers can refresh.
   * Notification failure is observer-only: the stored row already counts.
   */
  private notify(): void {
    try {
      this.onRecorded();
    } catch {
      // Notification must never mask or undo a persisted write.
    }
  }

  observeCompactions(models: Models): void {
    if (observedModels.has(models)) return;
    observedModels.add(models);
    installCompactionObserver(this.store, () => this.notify(), models);
  }

  extension(currentSelection: () => Promise<ChatSelection | null>): Extension {
    const store = this.store;
    return defineExtension({
      name: ACCOUNTING_EXTENSION_NAME,
      hooks: [
        hook(GenerationTask, {
          afterResponse: async (message, api) => {
            try {
              const selection = await currentSelection();
              const actual = messageModelId(message);
              const model = actual ?? selection?.model ?? null;
              store.record({
                attemptKey: `generation:${String(api.taskId)}:${message.responseId ?? message.timestamp}`,
                kind: "generation",
                taskId: String(api.taskId),
                stopReason: message.stopReason,
                model,
                effort: messageEffort(message) ?? selection?.effort ?? null,
                amount: amountOfUsage(message.usage, model, selection?.model ?? null),
                recordedAt: Date.now(),
              });
              this.notify();
            } catch {
              // Accounting observes; it never breaks accepted native output.
            }
          },
        }),
      ],
    });
  }

  /**
   * External title actuals; a claim first written with null upgrades in place.
   * Storage failures propagate: the parent's private route must fail instead of
   * reporting success, and a failed pre-claim must stop the paid title call.
   */
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
    this.notify();
  }

  /**
   * External per-chat speech actuals in their real billing unit. A storage
   * failure propagates so already-paid audio work is never silently missing.
   */
  recordSpeech(speech: SpeechUsage): void {
    this.store.recordSpeech(speech, Date.now());
    this.notify();
  }

  usage(source: ChatAccountingSource): Promise<ChatUsage> {
    const lifetime = this.store.lifetime();
    return Promise.resolve(
      aggregateChatUsage({
        attempts: lifetime.attempts,
        titles: lifetime.titles,
        speech: lifetime.speech,
        recent: this.store.recentAttempts(ACCOUNTING_RECENT_ATTEMPTS),
        nativeModels: source.nativeUsage?.models ?? null,
        context: source.context,
      }),
    );
  }
}

/** Per-message transcript facts; also exported from the amount module. */
export { messageUsage } from "./chat-accounting-amount.ts";
