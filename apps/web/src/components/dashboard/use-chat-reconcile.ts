import { useLayoutEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { ChatMessage } from "@/lib/chat-api";
import { commitOrder } from "./chat-history-rows";
import { evictChunks, reconcileChunks, sameChunks, type Items } from "./chat-history-text";

export type ChunkState = { chatId: string; attachment: string; items: Items; bytes: number };
export type Guard = {
  reconcile: number;
  latest: Map<string, string>;
  busy: Map<string, string>;
  controllers: Set<AbortController>;
};

type Options = {
  scope: string;
  chatId: string;
  attachment: string;
  rows: ChatMessage[];
  budgetRows: ChatMessage[];
  guardRef: RefObject<Guard>;
  scopeRef: RefObject<string>;
  generationRef: RefObject<number>;
  setState: Dispatch<SetStateAction<ChunkState>>;
};

/**
 * Persisted reconciliation of retained chunks against the reader rows, with
 * eviction accounting for every supplied budget row (including hidden snapshot
 * prefixes). The queued update is fenced by reconciliation token, scope and
 * generation before and inside the updater, and is idempotent by bytes and
 * chunk identity.
 */
export function useChatReconcile(options: Options) {
  const {
    scope,
    chatId,
    attachment,
    rows,
    budgetRows,
    guardRef,
    scopeRef,
    generationRef,
    setState,
  } = options;
  useLayoutEffect(() => {
    const guard = guardRef.current;
    const generation = generationRef.current;
    const token = ++guard.reconcile;
    const fenced = () =>
      guard.reconcile !== token ||
      scopeRef.current !== scope ||
      generationRef.current !== generation;
    queueMicrotask(() => {
      if (fenced()) return;
      setState((prev) => {
        if (fenced()) return prev;
        const scoped = prev.chatId === chatId && prev.attachment === attachment ? prev.items : {};
        const items = reconcileChunks(scoped, rows);
        const evicted = evictChunks(items, budgetRows, (id) => commitOrder(id)?.[0] ?? 0);
        if (
          prev.chatId === chatId &&
          prev.attachment === attachment &&
          prev.bytes === evicted.bytes &&
          sameChunks(prev.items, evicted.chunks)
        ) {
          return prev;
        }
        return { chatId, attachment, items: evicted.chunks, bytes: evicted.bytes };
      });
    });
  }, [attachment, budgetRows, chatId, guardRef, generationRef, rows, scope, scopeRef, setState]);
}
