import type { ComponentProps } from "react";
import { ThreadPrimitive } from "@assistant-ui/react";
import type { ChatSnapshot } from "@/lib/chat-api";
import ChatFooter from "./chat-footer";
import ChatStart from "./chat-start";
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
  footer,
}: {
  history: ReturnType<typeof useChatHistory>;
  snapshot: ChatSnapshot | null;
  running: boolean;
  archived: boolean;
  runError: string | null;
  actionError: string | null;
  chatId: string;
  footer: ComponentProps<typeof ChatFooter>;
}) {
  const empty = snapshot !== null && history.rows.length + history.live.length === 0 && !running;
  const notices = (
    <>
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
      <ChatNotices chatId={chatId} />
    </>
  );
  return (
    <ThreadPrimitive.Root data-cx="chat-thread" aria-label="Assistant chat">
      <ThreadPrimitive.Viewport data-cx="chat-viewport" data-empty={empty && !archived}>
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
        {empty && (
          <p data-cx="chat-empty">
            {archived ? "This chat has no messages." : "What would you like to work on?"}
          </p>
        )}
      </ThreadPrimitive.Viewport>
      {chatId === "none" ? (
        <>
          {notices}
          <ChatStart />
        </>
      ) : (
        <ChatFooter {...footer}>{notices}</ChatFooter>
      )}
    </ThreadPrimitive.Root>
  );
}
