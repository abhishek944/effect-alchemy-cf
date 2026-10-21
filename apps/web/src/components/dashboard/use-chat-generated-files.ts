import { useEffect, useState } from "react";
import {
  getAssistantSavedFiles,
  type AssistantSavedFilesPage,
} from "@/lib/chat-library-message-api";
import { libraryReadMessage } from "@/lib/chat-library-api";

type Navigation = { scope: string; cursor: string | null; previous: readonly (string | null)[] };

/** One bounded receipt page; retained identities survive failed read refreshes. */
export function useChatGeneratedFiles(options: {
  chatId: string | null;
  messageId: string;
  attachment: string;
  enabled: boolean;
  active: boolean;
  pending: boolean;
}) {
  const { chatId, messageId, attachment, enabled, active, pending } = options;
  const scope = JSON.stringify([chatId, messageId]);
  const [navigation, setNavigation] = useState<Navigation>({ scope, cursor: null, previous: [] });
  if (navigation.scope !== scope) setNavigation({ scope, cursor: null, previous: [] });
  const nav = navigation.scope === scope ? navigation : { scope, cursor: null, previous: [] };
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<{
    scope: string;
    cursor: string | null;
    value: AssistantSavedFilesPage;
  } | null>(null);
  const [read, setRead] = useState<{ key: string; error: string | null } | null>(null);
  const cursor = nav.cursor;
  // Response settlement re-reads receipts once; never count tools or poll paid work.
  const key = JSON.stringify([scope, attachment, cursor, attempt, pending, enabled]);
  useEffect(() => {
    if (!chatId || !enabled || !active) return undefined;
    const controller = new AbortController();
    void getAssistantSavedFiles(chatId, messageId, cursor, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) {
          setPage({ scope, cursor, value });
          setRead({ key, error: null });
        }
        return undefined;
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setRead({ key, error: libraryReadMessage(error) });
      },
    );
    return () => controller.abort();
  }, [chatId, messageId, enabled, active, scope, cursor, key]);
  const current = page?.scope === scope ? page : null;
  const completed = read?.key === key;
  const error = completed ? read.error : null;
  const state = !enabled ? "idle" : !completed ? "loading" : error ? "error" : "ready";
  const canAdvance = state === "ready" && current?.cursor === cursor;
  return {
    files: current?.value.files ?? [],
    state,
    error,
    retry: () => setAttempt((value) => value + 1),
    hasNext: canAdvance && Boolean(current?.value.nextCursor),
    hasPrevious: nav.previous.length > 0,
    next: () => {
      const next = current?.value.nextCursor;
      if (!canAdvance || !next) return;
      setNavigation((value) =>
        value.scope !== scope || value.cursor !== cursor
          ? value
          : {
              scope,
              cursor: next,
              previous: [...value.previous, value.cursor].slice(-50),
            },
      );
    },
    previous: () =>
      setNavigation((value) =>
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
