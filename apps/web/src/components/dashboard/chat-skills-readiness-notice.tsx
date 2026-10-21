/**
 * Pure pre-acceptance readiness notice. Geometry and actions reuse the existing
 * composer-adjacent `chat-retry` bar; this component owns no probe, store or
 * dispatch. Try again only rechecks readiness and never sends, clears the draft,
 * changes the selection or repairs an original operation.
 */
export default function ChatSkillsReadinessNotice({
  message,
  checking,
  onRetry,
}: {
  /** Null when readiness is ready/unknown; a reason when known unavailable. */
  message: string | null;
  checking: boolean;
  onRetry: () => void;
}) {
  if (message === null) return null;
  const reason = message.trim() || "Skills are temporarily unavailable. Try again shortly.";
  return (
    <div
      data-cx="chat-retry"
      role="alert"
      title={reason}
      aria-label={`Skills unavailable. ${reason}`}
    >
      <span>Skills unavailable. Your message is kept.</span>
      <button
        type="button"
        data-cx="chat-retry-action"
        disabled={checking}
        aria-busy={checking || undefined}
        aria-label={
          checking ? "Checking skill availability" : "Try again checking skill availability"
        }
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}
