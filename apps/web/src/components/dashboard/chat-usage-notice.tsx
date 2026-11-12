import { useChatStore } from "@/lib/chat-store-context";

/** Only actionable native-usage failures belong above the input, never loading copy. */
export default function ChatUsageNotice() {
  const { usage, status, error, mismatch, reload, reconcile } = useChatStore().usage;
  if (usage || (!mismatch && status !== "error")) return null;
  return (
    <div data-cx="chat-usage-notice" role="alert">
      <span>{mismatch ? "Usage model changed" : "Native usage unavailable"}</span>
      <button type="button" data-cx="usage-action" onClick={mismatch ? reconcile : reload}>
        {mismatch ? "Refresh model settings and retry" : "Retry usage"}
      </button>
      {error && <span className="sr-only">{error}</span>}
    </div>
  );
}
