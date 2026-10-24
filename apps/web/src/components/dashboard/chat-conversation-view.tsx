import type { ComponentProps } from "react";
import { ThreadPrimitive } from "@assistant-ui/react";
import type { ChatSnapshot } from "@/lib/chat-api";
import ChatFooter from "./chat-footer";
import ChatMessageList from "./chat-message-list";
import ChatNotices from "./chat-notices";
import { HistoryControls } from "./chat-history-ui";
import type { useChatHistory } from "./use-chat-history";

/** Thread presentation only; runtime, voice and operation admission remain in the owner. */
export function ChatConversationView({
  history,
  snapshot,
  running,
  archived,
  runError,
  actionError,
  chatId,
  otherTitle,
  footer,
}: {
  history: ReturnType<typeof useChatHistory>;
  snapshot: ChatSnapshot | null;
  running: boolean;
  archived: boolean;
  runError: string | null;
  actionError: string | null;
  chatId: string;
  otherTitle: string | null;
  footer: ComponentProps<typeof ChatFooter>;
}) {
  return (
    <ThreadPrimitive.Root data-cx="chat-thread" aria-label="Assistant chat">
      {footer.reconnecting && (
        <output
          id="chat-connection"
          data-cx="chat-reconnecting"
          aria-live={footer.announce ? "polite" : "off"}
        >
          {footer.status}
        </output>
      )}
      <ThreadPrimitive.Viewport data-cx="chat-viewport">
        <HistoryControls
          gap={history.gap}
          newerUnloaded={history.newerUnloaded}
          hasOlder={history.hasOlder}
          loading={history.loading}
          error={history.error}
          onLoadOlder={history.loadOlder}
          onLoadMissing={history.loadMissing}
          onReturnToLatest={history.returnToLatest}
        />
        <ChatMessageList />
        {snapshot && history.rows.length + history.live.length === 0 && !running && (
          <p data-cx="chat-empty">
            {archived ? "This chat has no messages." : "Ask anything to start this chat."}
          </p>
        )}
      </ThreadPrimitive.Viewport>
      {runError && (
        <p data-cx="chat-error" role="alert">
          {runError}
        </p>
      )}
      {actionError && (
        <p data-cx="chat-error" data-kind="action" role="alert">
          {actionError}
        </p>
      )}
      <ChatNotices chatId={chatId} otherTitle={otherTitle} />
      <ChatFooter {...footer} />
    </ThreadPrimitive.Root>
  );
}
