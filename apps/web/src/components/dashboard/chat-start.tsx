import { useChatStore } from "@/lib/chat-store-context";
import CatalogActionNotice from "./catalog-action-notice";
import NewChatButton from "./new-chat-button";
import "./chat-start.css";

/** No editable draft exists until an explicit chat has a real owner. */
export default function ChatStart() {
  const { creating, listState } = useChatStore();
  return (
    <div data-cx="chat-footer">
      <CatalogActionNotice />
      <section data-cx="chat-start" aria-label="Start a chat">
        <output>
          {creating
            ? "Starting a new chat…"
            : listState === "loading"
              ? "Loading your chats…"
              : "Choose a saved chat or start a new one to send messages."}
        </output>
        <NewChatButton />
      </section>
    </div>
  );
}
