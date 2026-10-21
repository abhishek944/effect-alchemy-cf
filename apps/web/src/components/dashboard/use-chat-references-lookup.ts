import { useEffect, useState } from "react";
import { libraryReadMessage, listSavedFiles } from "@/lib/chat-library-api";
import type { SavedLibraryPage } from "@/lib/chat-library-types";

type Navigation = { scope: string; cursor: string | null; previous: readonly (string | null)[] };

/** One bounded picker page; database name filtering covers the complete saved collection. */
export function useChatReferencesLookup(chatId: string, search: string | null) {
  const scope = JSON.stringify([chatId, search]);
  const [nav, setNav] = useState<Navigation>({ scope, cursor: null, previous: [] });
  if (nav.scope !== scope) setNav({ scope, cursor: null, previous: [] });
  const current = nav.scope === scope ? nav : { scope, cursor: null, previous: [] };
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([scope, current.cursor, attempt]);
  const [read, setRead] = useState<{
    key: string;
    page: SavedLibraryPage | null;
    error: string | null;
  } | null>(null);
  const cursor = current.cursor;
  useEffect(() => {
    if (search === null) return undefined;
    const controller = new AbortController();
    void listSavedFiles(
      chatId,
      {
        search,
        kind: "all",
        origin: "all",
        sort: "newest",
        limit: 30,
        ...(cursor === null ? {} : { cursor }),
      },
      controller.signal,
    ).then(
      (page) => {
        if (!controller.signal.aborted) setRead({ key, page, error: null });
        return undefined;
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setRead({ key, page: null, error: libraryReadMessage(error) });
      },
    );
    return () => controller.abort();
  }, [chatId, search, cursor, key]);
  const page = read?.key === key ? read.page : null;
  const error = read?.key === key ? read.error : null;
  return {
    key,
    files: page?.files ?? [],
    state: page ? ("ready" as const) : error ? ("error" as const) : ("loading" as const),
    error,
    retry: () => setAttempt((value) => value + 1),
    hasNext: Boolean(page?.nextCursor),
    hasPrevious: current.previous.length > 0,
    next: () => {
      if (!page?.nextCursor) return;
      setNav((value) =>
        value.scope !== scope || value.cursor !== cursor
          ? value
          : {
              scope,
              cursor: page.nextCursor,
              previous: [...value.previous, value.cursor].slice(-50),
            },
      );
    },
    previous: () =>
      setNav((value) =>
        value.scope !== scope || !value.previous.length
          ? value
          : {
              scope,
              cursor: value.previous[value.previous.length - 1] ?? null,
              previous: value.previous.slice(0, -1),
            },
      ),
  };
}
