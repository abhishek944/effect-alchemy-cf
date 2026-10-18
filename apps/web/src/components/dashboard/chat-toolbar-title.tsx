import { useChatStore } from "@/lib/chat-store-context";
import { Icon } from "./icon";

export default function ChatToolbarTitle() {
  const { selectedId, chats, snapshot } = useChatStore();
  const catalog = chats.find((chat) => chat.id === selectedId);
  const live = snapshot?.chat.id === selectedId ? snapshot.chat : undefined;
  const chat =
    live && (!catalog || Date.parse(live.updatedAt) > Date.parse(catalog.updatedAt))
      ? live
      : catalog;
  const title = chat?.title.trim() || "New chat";

  return (
    <>
      <Icon name="message-circle" />
      <span title={title}>{title}</span>
    </>
  );
}
