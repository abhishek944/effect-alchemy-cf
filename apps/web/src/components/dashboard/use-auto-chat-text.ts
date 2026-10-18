import { useCallback, useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/chat-api";
import {
  atSectionLimit,
  chunkFor,
  continuationCursor,
  textBytes,
  TEXT_BYTES_LIMIT,
  type Items,
} from "./chat-history-text";

type Attempt = {
  revision: string;
  cursor: string;
  pages: number;
  loaded: boolean;
  through: number;
  prefixCursor: string | null;
};
const lostText = (row: ChatMessage, chunks: Items, attempt: Attempt) =>
  attempt.loaded &&
  !chunkFor(row, chunks) &&
  (row.text.length < attempt.through || row.textCursor === attempt.prefixCursor);
const MAX_PAGES = 128;
const RESERVE_BYTES = 64 * 1024;

/** One bounded read at a time; never retry failed cursors or refill evicted text. */
export function useAutoChatText(
  scope: string,
  rows: ChatMessage[],
  budgetRows: ChatMessage[],
  chunks: Items,
  loadingId: string | null,
  request: (messageId: string, mode: "next" | "back") => Promise<void>,
) {
  const attempts = useRef<{ scope: string; items: Map<string, Attempt> }>({
    scope,
    items: new Map(),
  });
  // React effect replay/reattachment aborts the old reader; allow a fresh read.
  useEffect(
    () => () => {
      if (attempts.current.scope === scope) attempts.current.items.clear();
    },
    [scope],
  );
  const full = textBytes(budgetRows, chunks) + RESERVE_BYTES > TEXT_BYTES_LIMIT;
  const currentAttempt = useCallback(
    (row: ChatMessage) => {
      const attempt = attempts.current.scope === scope ? attempts.current.items.get(row.id) : null;
      return attempt?.revision === row.textRevision ? attempt : null;
    },
    [scope],
  );

  useEffect(() => {
    if (attempts.current.scope !== scope) attempts.current = { scope, items: new Map() };
    const retained = new Set(rows.map((row) => row.id));
    for (const id of attempts.current.items.keys()) {
      if (!retained.has(id)) attempts.current.items.delete(id);
    }
    for (const row of rows) {
      const attempt = currentAttempt(row);
      const chunk = chunkFor(row, chunks);
      if (attempt && chunk) {
        attempt.loaded = true;
        attempt.through = Math.max(attempt.through, chunk.baseLength + chunk.text.length);
        attempt.prefixCursor = row.textCursor;
      }
    }
    if (loadingId !== null || full) return;
    for (const row of rows.toReversed()) {
      const cursor = continuationCursor(row, chunks);
      if (row.textState !== "preview" || !cursor || atSectionLimit(chunks, row.id)) continue;
      const attempt = currentAttempt(row);
      if (
        attempt &&
        (attempt.cursor === cursor || attempt.pages >= MAX_PAGES || lostText(row, chunks, attempt))
      ) {
        continue;
      }
      attempts.current.items.set(row.id, {
        revision: row.textRevision,
        cursor,
        pages: (attempt?.pages ?? 0) + 1,
        loaded: attempt?.loaded ?? false,
        through: attempt?.through ?? row.text.length,
        prefixCursor: attempt?.prefixCursor ?? row.textCursor,
      });
      void request(row.id, "next");
      break;
    }
  }, [chunks, currentAttempt, full, loadingId, request, rows, scope]);

  const noticeFor = useCallback(
    (row: ChatMessage): string | null => {
      const cursor = continuationCursor(row, chunks);
      if (row.textState !== "preview" || !cursor) return null;
      if (loadingId === row.id) return "Loading message text…";
      const attempt = currentAttempt(row);
      if (
        full ||
        atSectionLimit(chunks, row.id) ||
        (attempt && (attempt.pages >= MAX_PAGES || lostText(row, chunks, attempt)))
      ) {
        return "Remaining message text exceeds this view’s display limit.";
      }
      if (attempt?.cursor === cursor) return "Message text could not be loaded. Reload to retry.";
      return "Loading message text…";
    },
    [chunks, currentAttempt, full, loadingId],
  );
  return { noticeFor };
}
