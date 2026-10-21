import { MessagePartPrimitive, MessagePrimitive, useAuiState } from "@assistant-ui/react";
import { ChatMarkdown } from "./chat-markdown";
import { MessageText, useHistoryText } from "./chat-history-ui";
import { AssistantActions, UserActions } from "./chat-message-actions";
import { SentSavedFiles, AssistantSavedFiles } from "./chat-message-files";
import "./chat-feedback.css";
import "./chat-message-actions.css";

function useOptimistic(): boolean {
  return useAuiState((state) => {
    const metadata = state.message.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
    return (metadata as Record<string, unknown>).isOptimistic === true;
  });
}

function UserText() {
  return <MessagePartPrimitive.Text component="p" smooth={false} />;
}

/** Truthful per-answer marker; never hides the partial text it describes. */
function IncompleteNote() {
  const incomplete = useAuiState((state) => {
    const metadata = state.message.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
    const custom: unknown = Reflect.get(metadata, "custom");
    if (!custom || typeof custom !== "object" || Array.isArray(custom)) return false;
    return Reflect.get(custom, "incomplete") === true;
  });
  if (!incomplete) return null;
  return (
    <span
      data-cx="chat-incomplete"
      title="This answer could not load its skills and is incomplete."
    >
      Incomplete
    </span>
  );
}

const assistantParts = { Text: ChatMarkdown };
const userParts = { Text: UserText };

/** Message-scoped child so the current assistant-ui message id is available. */
function MessageTail() {
  const messageId = useAuiState((state) => state.message.id);
  return <MessageText messageId={messageId} />;
}

function WorkingDots() {
  const emptyRunning = useAuiState(
    (state) =>
      state.message.status?.type === "running" &&
      !state.message.content.some((part) => part.type === "text" && part.text.length > 0),
  );
  const { working } = useHistoryText();
  if (!working || !emptyRunning) return null;
  return (
    <div data-cx="chat-working">
      <span data-cx="chat-working-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>Working</span>
    </div>
  );
}

export function UserMessage() {
  const optimistic = useOptimistic();
  return (
    <MessagePrimitive.Root data-cx="chat-message" data-role="user">
      <MessagePrimitive.Parts components={userParts} />
      {!optimistic && <SentSavedFiles />}
      <MessageTail />
      <UserActions optimistic={optimistic} />
    </MessagePrimitive.Root>
  );
}

export function ChatMessage({ messageRole = "assistant" }: { messageRole?: "user" | "assistant" }) {
  const optimistic = useOptimistic();
  return (
    <MessagePrimitive.Root data-cx="chat-message" data-role={messageRole}>
      <MessagePrimitive.Parts
        components={messageRole === "assistant" ? assistantParts : userParts}
      />
      <MessageTail />
      {messageRole === "assistant" && (
        <>
          <IncompleteNote />
          <WorkingDots />
          <AssistantSavedFiles />
          <AssistantActions optimistic={optimistic} />
        </>
      )}
    </MessagePrimitive.Root>
  );
}
