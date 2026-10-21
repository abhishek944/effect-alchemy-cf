import type { ChatLibraryOpen } from "./use-chat-library-open";

export function ChatLibraryOpenStatus({ read }: { read: ChatLibraryOpen }) {
  if (read.state === "loading")
    return <output data-cx="chat-library-workspace-status">Reading saved file…</output>;
  if (read.state !== "error") return null;
  return (
    <div data-cx="chat-library-workspace-status" role="alert">
      <span>{read.error}</span>
      <button type="button" onClick={() => void read.retry()}>
        Retry reading file
      </button>
      <button type="button" onClick={read.dismiss}>
        Dismiss
      </button>
    </div>
  );
}
