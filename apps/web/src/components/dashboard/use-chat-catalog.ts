import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChat,
  ChatApiError,
  errorMessage,
  listChats,
  newOperationId,
  updateChat,
  type Chat,
} from "@/lib/chat-api";
import type { ChatActionError, ListState } from "@/lib/chat-store-context";
import { useBoundedCatalogRefresh } from "./use-chat-metadata-refresh";

const byUpdated = (a: Chat, b: Chat) => b.updatedAt.localeCompare(a.updatedAt);
const atLeastAsNew = (a: Chat, b: Chat) => Date.parse(a.updatedAt) >= Date.parse(b.updatedAt);
const catalogErrorMessage = (error: unknown) =>
  error instanceof ChatApiError || error instanceof TypeError
    ? errorMessage(error)
    : "Chat details could not be confirmed. Check your chats before trying again.";

type Options = {
  onSelect: (id: string) => void;
  setActionError: (error: ChatActionError | null) => void;
};

/**
 * Owns the saved-chat catalog. PATCH requests are serialized per chat, so a
 * rename and archive of the same chat cannot be reordered by the server or
 * have one successful full row dropped because another request was issued:
 * each request starts only after the previous one settles, and every actual
 * successful row is applied in issue order. Other chats run independently. A
 * list GET is discarded by epoch when a newer refresh or completed mutation
 * already applied, and accepted metadata must not be older than what is
 * already installed in either the list or the override map.
 */
export function useChatCatalog({ onSelect, setActionError }: Options) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [listState, setListState] = useState<ListState>("loading");
  const [listError, setListError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Chat>>({});
  const listEpochRef = useRef(0);
  const creatingRef = useRef(false);
  const patchChainRef = useRef<Record<string, Promise<void>>>({});
  const chatsRef = useRef<Chat[]>([]);
  const mountedRef = useRef(true);
  const navigationRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    navigationRef.current = controller;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  const install = useCallback((next: Chat) => {
    setChats((current) =>
      current
        .map((chat) => (chat.id === next.id && atLeastAsNew(next, chat) ? next : chat))
        .toSorted(byUpdated),
    );
    setOverrides((current) => {
      const existing = current[next.id];
      if (existing && !atLeastAsNew(next, existing)) return current;
      return { ...current, [next.id]: next };
    });
  }, []);

  const applyChats = useCallback((epoch: number, next: Chat[]) => {
    if (!mountedRef.current || epoch !== listEpochRef.current) return;
    setChats((current) => {
      const known = new Map(current.map((chat) => [chat.id, chat]));
      return next
        .map((chat) => {
          const previous = known.get(chat.id);
          return previous && !atLeastAsNew(chat, previous) ? previous : chat;
        })
        .toSorted(byUpdated);
    });
    // Streams retain attachment-time headers; authoritative catalog metadata wins.
    setOverrides((current) => {
      const merged = { ...current };
      for (const chat of next) {
        const previous = merged[chat.id];
        if (!previous || atLeastAsNew(chat, previous)) merged[chat.id] = chat;
      }
      return merged;
    });
    setListState("ready");
    setListError(null);
  }, []);

  const applyListError = useCallback((epoch: number, error: unknown) => {
    if (!mountedRef.current || epoch !== listEpochRef.current) return;
    setListState("error");
    setListError(catalogErrorMessage(error));
  }, []);

  const refreshList = useCallback(() => {
    const epoch = ++listEpochRef.current;
    void listChats().then(
      (next) => applyChats(epoch, next),
      (error: unknown) => applyListError(epoch, error),
    );
  }, [applyChats, applyListError]);

  const refreshMetadata = useBoundedCatalogRefresh(refreshList);

  const startNewChat = useCallback(async () => {
    if (creatingRef.current || !mountedRef.current) return;
    creatingRef.current = true;
    // Finish saving, but do not steal a later navigation or a new owner’s selection.
    let navigated = false;
    const onNavigate = () => {
      navigated = true;
    };
    window.addEventListener(
      "popstate",
      onNavigate,
      navigationRef.current ? { signal: navigationRef.current.signal } : undefined,
    );
    setCreating(true);
    setActionError(null);
    try {
      const chat = await createChat(newOperationId());
      listEpochRef.current += 1;
      setChats((current) => [chat, ...current.filter((item) => item.id !== chat.id)]);
      setOverrides((current) => ({ ...current, [chat.id]: chat }));
      setListState("ready");
      setListError(null);
      if (!navigated && mountedRef.current) onSelect(chat.id);
    } catch (error) {
      setActionError({
        title: "Couldn’t start a new chat",
        message:
          error instanceof TypeError
            ? "The server did not respond. Check your chats before starting another."
            : catalogErrorMessage(error),
        dismissLabel: "Dismiss new-chat error",
      });
    } finally {
      window.removeEventListener("popstate", onNavigate);
      creatingRef.current = false;
      setCreating(false);
    }
  }, [onSelect, setActionError]);

  const runPatch = useCallback(
    async (id: string, patch: { title?: string; archived?: boolean }) => {
      setActionError(null);
      const label = patch.title !== undefined ? "rename" : patch.archived ? "archive" : "unarchive";
      const name = chatsRef.current.find((chat) => chat.id === id)?.title ?? "this chat";
      try {
        const next = await updateChat(id, patch);
        listEpochRef.current += 1;
        install(next);
      } catch (error) {
        setActionError({
          title: `Couldn’t ${label} “${name}”`,
          message: catalogErrorMessage(error),
          dismissLabel: `Dismiss error for ${name}`,
        });
      }
    },
    [install, setActionError],
  );

  const patchChat = useCallback(
    (id: string, patch: { title?: string; archived?: boolean }) => {
      const previous = patchChainRef.current[id] ?? Promise.resolve();
      const next = previous.then(() => runPatch(id, patch));
      patchChainRef.current[id] = next.catch(() => undefined);
      return next;
    },
    [runPatch],
  );

  return {
    chats,
    listState,
    listError,
    creating,
    overrides,
    refreshList: refreshMetadata,
    startNewChat,
    patchChat,
  };
}
