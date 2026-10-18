import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type Ref } from "react";
import type { Chat } from "@/lib/chat-api";
import { useChatStore } from "@/lib/chat-store-context";
import { Icon, type IconName } from "./icon";
import ChatSearch from "./chat-search";
import NewChatButton from "./new-chat-button";
import ReadErrorNotice from "./read-error-notice";
import Tooltip from "./tooltip";
import "./chat-sidebar.css";

const MAX_TITLE = 120;
function RowAction({
  label,
  icon,
  onClick,
  ref: el,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <Tooltip label={label}>
      <button ref={el} type="button" data-cx="chat-row-action" aria-label={label} onClick={onClick}>
        <Icon name={icon} />
      </button>
    </Tooltip>
  );
}
function RenameForm({
  chat,
  onSave,
  onCancel,
}: {
  chat: Chat;
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(chat.title);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.trim();
    if (title.length < 1 || title.length > MAX_TITLE) return;
    onSave(title);
  };
  return (
    <form data-cx="chat-rename" onSubmit={submit}>
      <label className="sr-only" htmlFor={`chat-title-${chat.id}`}>
        Rename chat
      </label>
      <input
        ref={inputRef}
        id={`chat-title-${chat.id}`}
        value={draft}
        maxLength={MAX_TITLE}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      />
      <button type="submit" data-cx="chat-row-action" aria-label={`Save name for ${chat.title}`}>
        <Icon name="check" />
      </button>
    </form>
  );
}
function ChatRow({
  chat,
  current,
  onSelect,
  onRename,
  onArchive,
}: {
  chat: Chat;
  current: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onArchive: (id: string, archived: boolean) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const renameTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  useLayoutEffect(() => {
    if (editing || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    renameTriggerRef.current?.focus();
  }, [editing]);
  const cancelRename = () => {
    restoreFocusRef.current = true;
    setEditing(false);
  };

  return (
    <div data-cx="chat-row" data-current={current ? "true" : undefined}>
      {editing ? (
        <RenameForm
          chat={chat}
          onCancel={cancelRename}
          onSave={(title) => {
            setEditing(false);
            void onRename(chat.id, title);
          }}
        />
      ) : (
        <>
          <button
            type="button"
            data-cx="chat-select"
            aria-current={current ? "true" : undefined}
            onClick={() => onSelect(chat.id)}
          >
            <Icon name="message-circle" />
            <span>{chat.title}</span>
          </button>
          <div data-cx="chat-row-actions">
            <RowAction
              ref={renameTriggerRef}
              label={`Rename ${chat.title}`}
              icon="square-pen"
              onClick={() => setEditing(true)}
            />
            <RowAction
              label={chat.archived ? `Unarchive ${chat.title}` : `Archive ${chat.title}`}
              icon={chat.archived ? "archive-restore" : "archive"}
              onClick={() => void onArchive(chat.id, !chat.archived)}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default function ChatSidebar() {
  const store = useChatStore();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = (chat: Chat) => needle === "" || chat.title.toLowerCase().includes(needle);
  const active = store.chats.filter((chat) => !chat.archived).filter(matches);
  const archived = store.chats.filter((chat) => chat.archived).filter(matches);
  const total = active.length + archived.length;

  return (
    <div ref={sidebarRef} tabIndex={-1} data-cx="chat-sidebar">
      <div data-cx="sidebar-heading">
        <strong>Chats</strong>
        <NewChatButton />
      </div>
      <ChatSearch value={query} onChange={setQuery} matches={total} />
      <nav data-cx="sidebar-navigation" aria-label="Saved chats">
        {store.listState === "loading" && store.chats.length === 0 && (
          <p data-cx="group-label">Loading chats…</p>
        )}
        {active.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            current={chat.id === store.selectedId}
            onSelect={store.select}
            onRename={store.renameChat}
            onArchive={store.setArchived}
          />
        ))}
        {active.length === 0 && store.listState === "ready" && needle === "" && (
          <p data-cx="search-empty">No chats yet. Use + New to start one.</p>
        )}
        {archived.length > 0 && <p data-cx="group-label">Archived</p>}
        {archived.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            current={chat.id === store.selectedId}
            onSelect={store.select}
            onRename={store.renameChat}
            onArchive={store.setArchived}
          />
        ))}
        {needle !== "" && total === 0 && store.listState === "ready" && (
          <p data-cx="search-empty">No saved chat titles match “{query.trim()}”.</p>
        )}
        {store.listError && (
          <ReadErrorNotice
            title="Couldn’t load chats"
            message={store.listError}
            actionLabel="Reload chats"
            onReload={store.reloadList}
            focusTarget={sidebarRef}
          />
        )}
      </nav>
    </div>
  );
}
