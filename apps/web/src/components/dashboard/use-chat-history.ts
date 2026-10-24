import { useCallback, useMemo } from "react";
import type { ChatMessage, ChatSnapshot } from "@/lib/chat-api";
import { applySnapshot, applyWindow, withChunks } from "./chat-history";
import { chunkFor, effectiveText, type Items } from "./chat-history-text";
import { isCommitted } from "./chat-history-rows";
import { useChatPager } from "./use-chat-pager";
import { useChatText } from "./use-chat-text";
import { useAutoChatText } from "./use-auto-chat-text";

export type HistoryTextState = {
  text: string;
  /** False for a later bounded text section, whose global tool positions are unknown. */
  isPrefix?: boolean;
  notice: string | null;
  complete: boolean;
  revision: string | null;
};

const NO_TEXT: HistoryTextState = {
  text: "",
  notice: null,
  complete: false,
  revision: null,
};
const NO_CHUNKS: Items = {};

/**
 * Composes the bounded history pager and per-message text sections for one
 * selected view. The snapshot window merges at render time; pages and chunks
 * are fenced by chat, attachment, cursor and revision, and neither ever changes
 * SSE readiness or settles a send except by exact loaded operation UUID.
 */
export function useChatHistory(
  selectedId: string | null,
  attachment: string,
  snapshot: ChatSnapshot | null,
  onOperations?: (chatId: string, ids: string[]) => void,
) {
  const pager = useChatPager(selectedId, attachment, onOperations);
  const baseView = useMemo(() => {
    if (snapshot && selectedId && snapshot.chat.id === selectedId) {
      return applySnapshot(pager.state, snapshot, NO_CHUNKS);
    }
    return applyWindow(pager.state, [], NO_CHUNKS);
  }, [pager.state, snapshot, selectedId]);
  const readerRows = useMemo(
    () => [...baseView.rows, ...baseView.live],
    [baseView.rows, baseView.live],
  );
  // Every retained prefix version counts, even for the same id (H3); exact
  // duplicate objects are dropped and continuations are counted once.
  const budgetRows = useMemo(() => {
    const unique = new Set<ChatMessage>();
    for (const row of pager.state.rows) unique.add(row);
    for (const row of snapshot?.messages ?? []) unique.add(row);
    for (const row of readerRows) unique.add(row);
    return [...unique];
  }, [pager.state.rows, readerRows, snapshot]);
  const text = useChatText(selectedId, attachment, readerRows, budgetRows);
  const view = useMemo(
    () => withChunks(baseView, text.chunks, budgetRows),
    [baseView, budgetRows, text.chunks],
  );

  const { noticeFor } = useAutoChatText(
    `${selectedId ?? ""}:${attachment}`,
    readerRows,
    budgetRows,
    view.chunks,
    text.loadingId,
    text.request,
  );
  const textFor = useCallback(
    (row: ChatMessage): HistoryTextState => {
      const chunk = chunkFor(row, view.chunks);
      const notice = noticeFor(row);
      return {
        text: effectiveText(row, view.chunks),
        isPrefix: !chunk || chunk.initial,
        notice,
        revision: row.textRevision,
        complete:
          isCommitted(row) &&
          !notice &&
          text.loadingId !== row.id &&
          (chunk ? chunk.initial && chunk.nextCursor === null : row.textState === "complete"),
      };
    },
    [noticeFor, text.loadingId, view.chunks],
  );

  const textForById = useCallback(
    (messageId: string): HistoryTextState => {
      const row = [...view.rows, ...view.live].find((message) => message.id === messageId);
      return row ? textFor(row) : NO_TEXT;
    },
    [textFor, view.live, view.rows],
  );

  const error = pager.error ?? text.error;
  const loadOlder = () => {
    if (view.cursor) {
      void pager.load(view.cursor, "older", view.ceilingEntryId, view.bridgeTarget);
    }
  };
  const loadMissing = () => {
    if (view.cursor) {
      void pager.load(view.cursor, "missing", view.ceilingEntryId, view.bridgeTarget);
    }
  };

  return {
    rows: view.rows,
    live: view.live,
    gap: view.gap,
    newerUnloaded: view.newerUnloaded,
    hasOlder: Boolean(view.cursor) || view.olderUnloaded,
    loading: pager.loading,
    error,
    loadOlder,
    loadMissing,
    returnToLatest: pager.returnToLatest,
    textFor,
    textForById,
  };
}
