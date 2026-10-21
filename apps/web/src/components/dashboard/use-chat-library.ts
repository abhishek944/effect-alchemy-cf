import { useCallback, useEffect, useState } from "react";
import { libraryReadMessage, listSavedFiles } from "@/lib/chat-library-api";
import {
  DEFAULT_LIBRARY_FILTERS,
  type LibraryFilters,
  type LibraryReadState,
  type SavedLibraryPage,
} from "@/lib/chat-library-types";

type Navigation = {
  chatId: string | null;
  filters: LibraryFilters;
  cursor: string | null;
  previous: readonly (string | null)[];
};
type Read = { key: string; scope: string; page: SavedLibraryPage | null; error: string | null };
const initial = (chatId: string | null): Navigation => ({
  chatId,
  filters: { ...DEFAULT_LIBRARY_FILTERS },
  cursor: null,
  previous: [],
});

/** Retains one bounded page. Mount once per catalog tab to retain its query/view. */
export function useChatLibrary(
  chatId: string | null,
  options: { active?: boolean; refreshKey?: string } = {},
) {
  const active = options.active ?? true;
  const [navigation, setNavigation] = useState(() => initial(chatId));
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<Read | null>(null);
  if (navigation.chatId !== chatId) setNavigation(initial(chatId));
  const current = navigation.chatId === chatId ? navigation : initial(chatId);
  const { filters, cursor } = current;
  const scope = JSON.stringify([chatId, filters, cursor]);
  const key = JSON.stringify([scope, attempt, options.refreshKey]);

  useEffect(() => {
    if (!active || !chatId) return undefined;
    const controller = new AbortController();
    void listSavedFiles(
      chatId,
      { ...filters, ...(cursor === null ? {} : { cursor }), limit: 30 },
      controller.signal,
    ).then(
      (page) => {
        if (!controller.signal.aborted) setRead({ key, scope, page, error: null });
        return undefined;
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setRead((previous) => ({
            key,
            scope,
            page: previous?.scope === scope ? previous.page : null,
            error: libraryReadMessage(error),
          }));
      },
    );
    return () => controller.abort();
  }, [chatId, filters, cursor, key, scope, active]);

  const page = read?.scope === scope ? read.page : null;
  const error = read?.key === key ? read.error : null;
  const state: LibraryReadState = !chatId
    ? "ready"
    : read?.key !== key
      ? "loading"
      : error
        ? "error"
        : "ready";
  const setFilters = useCallback(
    (next: LibraryFilters) => {
      setNavigation({ chatId, filters: next, cursor: null, previous: [] });
    },
    [chatId],
  );
  const first = () => setNavigation((value) => ({ ...value, cursor: null, previous: [] }));
  const next = () => {
    if (!page?.nextCursor || state !== "ready") return;
    setNavigation((value) =>
      value.chatId !== chatId || value.cursor !== cursor
        ? value
        : {
            ...value,
            cursor: page.nextCursor,
            previous: [...value.previous, value.cursor].slice(-50),
          },
    );
  };
  const previous = () => {
    setNavigation((value) => {
      if (!value.previous.length) return value;
      return {
        ...value,
        cursor: value.previous[value.previous.length - 1] ?? null,
        previous: value.previous.slice(0, -1),
      };
    });
  };

  return {
    chatId,
    filters,
    setFilters,
    files: page?.files ?? [],
    state,
    error,
    retry: () => setAttempt((value) => value + 1),
    next,
    previous,
    first,
    hasNext: page?.nextCursor !== null && page?.nextCursor !== undefined,
    hasPrevious: current.previous.length > 0,
    isFirst: cursor === null,
  };
}

export type ChatLibrary = ReturnType<typeof useChatLibrary>;
