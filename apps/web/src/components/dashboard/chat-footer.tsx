import { useRef, useState } from "react";
import { useChatStore } from "@/lib/chat-store-context";
import ChatComposer from "./chat-composer";
import CatalogActionNotice from "./catalog-action-notice";
import ChatIcon from "./chat-icon";
import ChatUsageTray from "./chat-usage-tray";
import { useChatLayout } from "./use-chat-layout";
import Tooltip from "./tooltip";
import "./chat-archive.css";

type Props = {
  archived: boolean;
  chatId: string;
  running: boolean;
  status: string;
  announcement: string;
  announce: boolean;
  stopLabel: string;
  sendLabel: string;
  stopping: boolean;
  onStop?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
};

/**
 * Archive hides the input, not the active run, its exact Stop target, draft
 * state or the usage tray. The tray follows the composer and tucks behind its
 * lower edge; available-height budgeting keeps retained controls reachable.
 */
export default function ChatFooter({
  archived,
  chatId,
  running,
  status,
  announcement,
  announce,
  stopLabel,
  sendLabel,
  stopping,
  onStop,
  onRetry,
}: Props) {
  const footerRef = useRef<HTMLDivElement>(null);
  useChatLayout(footerRef);
  const { setArchived } = useChatStore();
  const [unarchiving, setUnarchiving] = useState(false);
  const pending = useRef(false);
  const unarchive = async () => {
    if (pending.current) return;
    pending.current = true;
    setUnarchiving(true);
    try {
      await setArchived(chatId, false);
    } finally {
      pending.current = false;
      setUnarchiving(false);
    }
  };

  return (
    <div ref={footerRef} data-cx="chat-footer" tabIndex={-1}>
      <CatalogActionNotice />
      {!archived ? (
        <ChatComposer
          chatId={chatId}
          running={running}
          stopping={stopping}
          stopLabel={stopLabel}
          sendLabel={sendLabel}
          onStop={onStop}
        />
      ) : (
        <section data-cx="chat-archived" aria-label="Archived chat">
          <p>This chat is archived.</p>
          <div data-cx="chat-archived-actions">
            {(running || stopping) && (
              <Tooltip label={stopLabel}>
                <button
                  type="button"
                  data-cx="chat-archive-action"
                  aria-label={stopLabel}
                  disabled={!onStop || stopping}
                  onClick={onStop}
                >
                  <ChatIcon name="stop" />
                  Stop
                </button>
              </Tooltip>
            )}
            <button
              type="button"
              data-cx="chat-archive-action"
              disabled={unarchiving}
              onClick={() => void unarchive()}
            >
              {unarchiving ? "Unarchiving…" : "Unarchive"}
            </button>
          </div>
        </section>
      )}
      <ChatUsageTray chatId={chatId} />
      <output
        id="chat-connection"
        data-cx="chat-connection"
        aria-live={announce ? "polite" : "off"}
        data-announcement-only={!status || undefined}
      >
        {status || announcement}
      </output>
      {onRetry && (
        <button type="button" data-cx="chat-retry-action" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
