import { useChatStore } from "@/lib/chat-store-context";
import { Icon } from "./icon";
import ChatSwitcher from "./chat-switcher";

export type ChatTitleControls = {
  sidebarOpen: boolean;
  onSelectChat: (id: string) => void;
};

export default function ChatToolbarTitle({ sidebarOpen, onSelectChat }: ChatTitleControls) {
  const { selectedId, chats, snapshot } = useChatStore();
  const catalog = chats.find((chat) => chat.id === selectedId);
  const live = snapshot?.chat.id === selectedId ? snapshot.chat : undefined;
  const chat =
    live && (!catalog || Date.parse(live.updatedAt) > Date.parse(catalog.updatedAt))
      ? live
      : catalog;
  const title = chat?.title.trim() || "New chat";

  if (!sidebarOpen) return <ChatSwitcher title={title} onSelect={onSelectChat} />;

  return (
    <>
      <Icon name="message-circle" />
      <span title={title}>{title}</span>
    </>
  );
}
