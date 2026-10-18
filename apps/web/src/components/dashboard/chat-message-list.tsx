import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import { dayLabel } from "@/lib/chat-time";
import { useHistoryText } from "./chat-history-ui";
import { ChatMessage, UserMessage } from "./chat-messages";

const messageComponents = { UserMessage, AssistantMessage: ChatMessage };

/**
 * Visible stored-time dividers between local days, keyed by message identity.
 * Divider days come from the raw stored stamp; a missing or invalid time
 * produces no divider and never borrows the runtime's synthesized date.
 */
export default function ChatMessageList() {
  const messages = useAuiState((state) => state.thread.messages);
  const { stampFor } = useHistoryText();
  return (
    <>
      {messages.map((message, index) => {
        const day = dayLabel(stampFor(message.id));
        const previous = index > 0 ? messages[index - 1] : undefined;
        const previousDay = previous ? dayLabel(stampFor(previous.id)) : null;
        return (
          <div key={message.id} data-cx="message-slot">
            {day && day !== previousDay && (
              <div data-cx="date-divider">
                <hr aria-hidden="true" />
                <span>{day}</span>
                <hr aria-hidden="true" />
              </div>
            )}
            <ThreadPrimitive.MessageByIndex index={index} components={messageComponents} />
          </div>
        );
      })}
    </>
  );
}
