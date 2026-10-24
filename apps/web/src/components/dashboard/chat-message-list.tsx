import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import { ChatMessage, UserMessage, WorkingDots } from "./chat-messages";

const messageComponents = { UserMessage, AssistantMessage: ChatMessage };

export default function ChatMessageList() {
  const messages = useAuiState((state) => state.thread.messages);
  return (
    <>
      {messages.map((message, index) => (
        <div key={message.id} data-cx="message-slot">
          <ThreadPrimitive.MessageByIndex index={index} components={messageComponents} />
        </div>
      ))}
      <WorkingDots />
    </>
  );
}
