import { useChatStore } from "@/lib/chat-store-context";
import ChatIcon from "./chat-icon";
import Tooltip from "./tooltip";

export default function NewChatButton() {
  const { creating, startNewChat } = useChatStore();
  return (
    <>
      <Tooltip label="New chat">
        <button
          type="button"
          data-cx="chat-new"
          aria-label="New chat"
          aria-busy={creating}
          disabled={creating}
          onClick={() => void startNewChat()}
        >
          <ChatIcon name="plus" />
          <span>New</span>
        </button>
      </Tooltip>
      <output className="sr-only" aria-live="polite">
        {creating ? "Starting a new chat…" : ""}
      </output>
    </>
  );
}
