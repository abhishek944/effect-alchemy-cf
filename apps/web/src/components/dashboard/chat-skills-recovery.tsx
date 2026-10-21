import { useChatStore } from "@/lib/chat-store-context";
import { useChatSkillsRecovery } from "./use-chat-skills-recovery";

/**
 * B7-A composer-adjacent recovery bar for a failed pinned skill attempt.
 * Try again means the original-version retry of the exact failed operation;
 * New Send is a separate current-skills operation shown only when the original
 * version is unrecoverable. The rendered target is frozen into the handler and
 * the composer draft is never touched.
 */
export default function ChatSkillsRecovery({ chatId }: { chatId: string }) {
  const { snapshot, preferences, reload, reportError } = useChatStore();
  const { recovery, target, busy, notice, retry, newSend } = useChatSkillsRecovery({
    snapshot: snapshot?.chat.id === chatId ? snapshot : null,
    reload,
    onError: reportError,
  });
  if (recovery === null || target === null) return null;
  return (
    <ChatSkillsRecoveryView
      message={recovery.message}
      canRetry={recovery.canRetry}
      working={busy !== null}
      notice={notice}
      onRetry={() => void retry(target)}
      onNewSend={() => void newSend(target, preferences.selection)}
    />
  );
}

type RecoveryViewProps = {
  readonly message: string;
  readonly canRetry: boolean;
  readonly working: boolean;
  readonly notice: string | null;
  readonly onRetry: () => void;
  readonly onNewSend: () => void;
};

/** Same live presentation, also usable for anonymous source-only displays. */
export function ChatSkillsRecoveryView({
  message,
  canRetry,
  working,
  notice,
  onRetry,
  onNewSend,
}: RecoveryViewProps) {
  return (
    <div data-cx="chat-retry" role="alert">
      <span title={message}>Answer incomplete. A skill could not load.</span>
      <button
        type="button"
        data-cx="chat-retry-action"
        aria-label="Try again using the original skill version"
        disabled={!canRetry || working}
        onClick={onRetry}
      >
        Try again
      </button>
      {!canRetry && (
        <button
          type="button"
          data-cx="chat-retry-action"
          aria-label="Send the original message again with the current skills"
          disabled={working}
          onClick={onNewSend}
        >
          New Send
        </button>
      )}
      <span data-cx="chat-retry-note">
        {canRetry ? "Uses original skills." : "The original skills are no longer available."}
      </span>
      {notice && <output data-cx="chat-retry-note">{notice}</output>}
    </div>
  );
}
