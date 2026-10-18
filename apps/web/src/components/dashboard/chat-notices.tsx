import { useChatStore } from "@/lib/chat-store-context";

/**
 * Pending-send notices. Every action carries the frozen chat/operation pair
 * captured from the visible state, so a stale handler cannot be re-addressed
 * from a changed selection. Retry is disabled while a Stop is in flight, and
 * explanations name the affected chat. Discard only forgets local state; it
 * never cancels accepted inference.
 */
export default function ChatNotices({
  chatId,
  otherTitle,
}: {
  chatId: string;
  otherTitle: string | null;
}) {
  const { pendingSend, stopping, retrySend, discardSend, select } = useChatStore();
  const pending = pendingSend?.chatId === chatId ? pendingSend : null;
  const otherPending = pendingSend && pendingSend.chatId !== chatId ? pendingSend : null;
  const failed = pending?.phase === "failed" ? pending : null;
  const stoppingNote = stopping ? `Stopping the answer in "${stopping.title}" first.` : null;

  return (
    <>
      {failed && (
        <div data-cx="chat-retry" role="alert">
          <span>{failed.error ?? "The message was not accepted."}</span>
          <button
            type="button"
            data-cx="chat-retry-action"
            disabled={Boolean(stopping)}
            onClick={() =>
              void retrySend({ chatId: failed.chatId, operationId: failed.operationId })
            }
          >
            Retry send
          </button>
          <button
            type="button"
            data-cx="chat-retry-action"
            aria-label="Discard this local retry. It does not cancel accepted work."
            onClick={() => discardSend({ chatId: failed.chatId, operationId: failed.operationId })}
          >
            Discard
          </button>
          <span data-cx="chat-retry-note">
            {stoppingNote ?? "Retrying reuses the same request."}
          </span>
        </div>
      )}
      {pending?.phase === "accepted" && (
        <output data-cx="chat-retry" aria-live="off">
          <span>Sent to the assistant. Waiting for this run to start.</span>
          <button
            type="button"
            data-cx="chat-retry-action"
            aria-label="Forget this local wait. It does not cancel accepted work."
            onClick={() =>
              discardSend({ chatId: pending.chatId, operationId: pending.operationId })
            }
          >
            Discard
          </button>
          <span data-cx="chat-retry-note">Stop is the action that cancels this run.</span>
        </output>
      )}
      {otherPending && otherTitle && (
        <output data-cx="chat-retry">
          <span>{`Sending is paused: the send in "${otherTitle}" is not resolved.`}</span>
          <button
            type="button"
            data-cx="chat-retry-action"
            onClick={() => select(otherPending.chatId)}
          >
            {`Open "${otherTitle}"`}
          </button>
          <button
            type="button"
            data-cx="chat-retry-action"
            aria-label="Forget this local pending send. It does not cancel accepted work."
            onClick={() =>
              discardSend({ chatId: otherPending.chatId, operationId: otherPending.operationId })
            }
          >
            Discard
          </button>
        </output>
      )}
    </>
  );
}
