import { useEffect, useId, useRef, useState } from "react";
import { useChatStore } from "@/lib/chat-store-context";
import { DropdownIndicator } from "./dropdown";
import { Icon } from "./icon";
import ReadErrorNotice from "./read-error-notice";
import "./chat-switcher.css";

/** Navigation only: catalog, routing, drafts and retained work keep their existing owners. */
export default function ChatSwitcher({
  title,
  onSelect,
}: {
  title: string;
  onSelect: (id: string) => void;
}) {
  const store = useChatStore();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const active = store.chats.filter((chat) => !chat.archived);
  const archived = store.chats.filter((chat) => chat.archived);

  useEffect(() => {
    const popup = popupRef.current;
    if (!popup) return undefined;
    const toggle = (event: Event) => {
      if (!(event instanceof ToggleEvent)) return;
      const expanded = event.newState === "open";
      setOpen(expanded);
      if (expanded) {
        const choice =
          popup.querySelector<HTMLButtonElement>("button[aria-current]") ??
          popup.querySelector<HTMLButtonElement>("button");
        (choice ?? popup).focus();
      } else if (popup.contains(document.activeElement)) {
        triggerRef.current?.focus();
      }
    };
    popup.addEventListener("toggle", toggle);
    return () => popup.removeEventListener("toggle", toggle);
  }, []);

  const close = () => popupRef.current?.hidePopover();
  const choose = (chatId: string) => {
    close();
    triggerRef.current?.focus();
    onSelect(chatId);
  };
  const rows = (chats: typeof store.chats) =>
    chats.map((chat) => (
      <button
        key={chat.id}
        type="button"
        data-cx="chat-switcher-row"
        title={chat.title}
        aria-current={chat.id === store.selectedId ? "true" : undefined}
        onClick={() => choose(chat.id)}
      >
        <Icon name="message-circle" />
        <span>{chat.title}</span>
        {chat.id === store.selectedId && <Icon name="check" />}
      </button>
    ));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-cx="chat-switcher-trigger"
        popoverTarget={id}
        aria-label={`Switch chat, current chat ${title}`}
        aria-controls={id}
        aria-expanded={open}
      >
        <Icon name="message-circle" />
        <span title={title}>{title}</span>
        <DropdownIndicator />
      </button>
      <nav
        ref={popupRef}
        id={id}
        popover="auto"
        tabIndex={-1}
        data-cx="chat-switcher-popup"
        aria-label="Saved chats"
        aria-busy={store.listState === "loading"}
      >
        {store.listState === "loading" && store.chats.length === 0 && (
          <output data-cx="chat-switcher-state">Loading chats…</output>
        )}
        {rows(active)}
        {archived.length > 0 && (
          <>
            {active.length > 0 && <div data-cx="chat-switcher-divider" />}
            <p data-cx="chat-switcher-group">Archived</p>
            {rows(archived)}
          </>
        )}
        {store.listState === "ready" && store.chats.length === 0 && (
          <p data-cx="chat-switcher-state">No saved chats yet.</p>
        )}
        {store.listError && (
          <ReadErrorNotice
            title="Couldn’t load chats"
            message={store.listError}
            actionLabel="Reload chats"
            onReload={store.reloadList}
            focusTarget={popupRef}
          />
        )}
      </nav>
    </>
  );
}
