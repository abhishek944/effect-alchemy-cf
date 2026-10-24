/**
 * Exact T27 compaction observer. Installed pi-durable 1.1.0 `compaction.js`
 * calls `runtime.models.completeSimple(model, { messages }, options)` at its
 * only summarization call site and commits the native usage afterwards, so
 * wrapping that one method records every terminal actual summary response —
 * resolved, rejected, or synchronously thrown — with the pinned call model and
 * `options.reasoning`, even when the process dies before that commit. Native
 * generation uses `streamSimple` and title uses a separate `ai` instance.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import { reportFailure } from "@starter/diagnostics";
import { amountOfUsage } from "./chat-accounting-amount.ts";
import { effortOf, messageModelId, modelIdOf, unknownAmount } from "./chat-accounting-model.ts";
import type { ChatAccountingStore } from "./chat-accounting-store.ts";
import type { ChatObjectMetadata } from "./chat-observation.ts";

export const installCompactionObserver = (
  store: ChatAccountingStore,
  notify: () => void,
  models: Models,
  metadata: ChatObjectMetadata = {},
): void => {
  const original = models.completeSimple.bind(models);
  models.completeSimple = (model, context, options) => {
    const pinned = modelIdOf(model.id);
    const effort = effortOf(options?.reasoning) ?? "off";
    const attemptKey = `summarization:${crypto.randomUUID()}`;
    const record = (message: AssistantMessage | null): void => {
      const actual = message === null ? null : messageModelId(message);
      try {
        store.record({
          attemptKey,
          kind: "summarization",
          taskId: null,
          stopReason: message?.stopReason ?? null,
          model: pinned ?? actual,
          effort,
          amount:
            message === null
              ? unknownAmount()
              : amountOfUsage(message.usage, actual ?? pinned, pinned),
          recordedAt: Date.now(),
        });
      } catch (error) {
        reportFailure(error, {
          ...metadata,
          component: "chat-accounting",
          operation: "compaction.observe",
          phase: "record",
          reason: "accounting_record_failed",
          event: "application.recovery",
        });
        return;
      }
      try {
        notify();
      } catch (error) {
        reportFailure(error, {
          ...metadata,
          component: "chat-accounting",
          operation: "compaction.observe",
          phase: "notify",
          reason: "accounting_notify_failed",
          event: "application.recovery",
        });
      }
    };
    let call: Promise<AssistantMessage>;
    try {
      call = original(model, context, options);
    } catch (error: unknown) {
      // A synchronous provider/auth failure is still an attempted summary.
      record(null);
      throw error;
    }
    return call.then(
      (message) => {
        record(message);
        return message;
      },
      (error: unknown) => {
        record(null);
        throw error;
      },
    );
  };
};
