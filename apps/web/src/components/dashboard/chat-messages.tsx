import { useMemo } from "react";
import { MessagePartPrimitive, MessagePrimitive, useAuiState } from "@assistant-ui/react";
import { ChatAssistantParts, ToolPreviewNote } from "./chat-assistant-parts";
import { MessageText, useHistoryText } from "./chat-history-ui";
import { MessageImageAltsProvider, collectMessageImageAlts } from "./chat-message-image-alts";
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

const userParts = { Text: UserText };

/** Message-scoped child so the current assistant-ui message id is available. */
function MessageTail() {
  const messageId = useAuiState((state) => state.message.id);
  return <MessageText messageId={messageId} />;
}

/** One thread-level marker stays visible through text and tool rounds. */
export function WorkingDots() {
  const { working } = useHistoryText();
  if (!working) return null;
  return (
    <div data-cx="chat-working">
      <span data-cx="chat-working-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>Working…</span>
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
  const messageId = useAuiState((state) => state.message.id);
  const nativeToolOnly = useAuiState(
    (state) =>
      state.message.content.some((part) => part.type === "tool-call") &&
      state.message.content.every(
        (part) => part.type === "tool-call" || (part.type === "text" && !part.text.trim()),
      ),
  );
  const { textFor, attachmentsFor, generatedFor } = useHistoryText();
  const alts = useMemo(
    () => collectMessageImageAlts(textFor(messageId).text),
    [messageId, textFor],
  );
  const hasFiles = attachmentsFor(messageId).length > 0 || generatedFor(messageId);
  const toolOnly =
    messageRole === "assistant" && nativeToolOnly && !hasFiles && !textFor(messageId).text.trim();
  return (
    <MessagePrimitive.Root
      data-cx="chat-message"
      data-role={messageRole}
      data-tool-only={toolOnly || undefined}
    >
      <MessageImageAltsProvider value={alts}>
        {messageRole === "assistant" ? (
          <ChatAssistantParts />
        ) : (
          <MessagePrimitive.Parts components={userParts} />
        )}
        <MessageTail />
        {messageRole === "assistant" && (
          <>
            <IncompleteNote />
            <ToolPreviewNote />
            <AssistantSavedFiles />
            <AssistantActions
              optimistic={optimistic}
              attachmentsOnly={hasFiles}
              toolOnly={toolOnly}
            />
          </>
        )}
      </MessageImageAltsProvider>
    </MessagePrimitive.Root>
  );
}
