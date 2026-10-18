import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { errorMessage, type ChatMessage } from "@/lib/chat-api";
import { getMessageText } from "@/lib/chat-history-api";
import { commitOrder } from "./chat-history-rows";
import {
  appendSection,
  atSectionLimit,
  backSection,
  chunkFor,
  continuationCursor,
  dropChunk,
  evictChunks,
  reconcileChunks,
  type SectionRef,
} from "./chat-history-text";
import { useChatReconcile, type ChunkState, type Guard } from "./use-chat-reconcile";
type ScopedError = { chatId: string; attachment: string; message: string };
type LoadingState = { scope: string; messageId: string; token: string };
const NO_ITEMS: Record<string, never> = {};
/** Bounded text reads; exact application tokens survive network completion. */
export function useChatText(
  selectedId: string | null,
  attachment: string,
  rows: ChatMessage[],
  budgetRows: ChatMessage[],
) {
  const scope = `${selectedId ?? ""}:${attachment}`;
  const [state, setState] = useState<ChunkState>(() => ({
    chatId: selectedId ?? "",
    attachment,
    items: {},
    bytes: 0,
  }));
  const [loadingState, setLoadingState] = useState<LoadingState | null>(null);
  const [failure, setFailure] = useState<ScopedError | null>(null);
  const rowsRef = useRef(rows);
  const budgetRef = useRef(budgetRows);
  const requestIdRef = useRef(0);
  const guardRef = useRef<Guard>({
    reconcile: 0,
    latest: new Map(),
    busy: new Map(),
    controllers: new Set(),
  });
  const scopeRef = useRef(scope);
  const generationRef = useRef(0);
  useLayoutEffect(() => {
    rowsRef.current = rows;
    budgetRef.current = budgetRows;
  }, [budgetRows, rows]);
  // Bounded provenance: tokens exist only for rows still retained in this view.
  useLayoutEffect(() => {
    const guard = guardRef.current;
    const retained = new Set(budgetRows.map((row) => row.id));
    for (const key of guard.latest.keys()) if (!retained.has(key)) guard.latest.delete(key);
    for (const key of guard.busy.keys()) if (!retained.has(key)) guard.busy.delete(key);
  }, [budgetRows]);
  useLayoutEffect(() => {
    const guard = guardRef.current;
    const reset = () => {
      generationRef.current += 1;
      guard.reconcile += 1;
      guard.latest.clear();
      guard.busy.clear();
      for (const controller of guard.controllers) controller.abort();
      guard.controllers.clear();
      const generation = generationRef.current;
      queueMicrotask(() => {
        if (generationRef.current === generation && guard.busy.size === 0) {
          setLoadingState((value) =>
            generationRef.current === generation && guard.busy.size === 0 && value?.scope === scope
              ? null
              : value,
          );
        }
      });
    };
    scopeRef.current = scope;
    reset();
    return () => {
      scopeRef.current = "";
      reset();
    };
  }, [scope]);
  useChatReconcile({
    scope,
    chatId: selectedId ?? "",
    attachment,
    rows,
    budgetRows,
    guardRef,
    scopeRef,
    generationRef,
    setState,
  });
  const scoped =
    state.chatId === (selectedId ?? "") && state.attachment === attachment ? state.items : NO_ITEMS;
  const chunks = useMemo(() => reconcileChunks(scoped, rows), [scoped, rows]);
  const loadingId = loadingState && loadingState.scope === scope ? loadingState.messageId : null;
  const request = useCallback(
    async (messageId: string, mode: "next" | "back") => {
      const guard = guardRef.current;
      const generation = generationRef.current;
      if (!selectedId || scopeRef.current !== scope) return;
      const row = rowsRef.current.find((message) => message.id === messageId);
      if (!row) return;
      const existing = chunks[messageId];
      let cursor: string | null;
      let backCheck: SectionRef | null = null;
      if (mode === "back") {
        if (!existing || existing.back.length === 0) return;
        const first = existing.back[0];
        if (first === undefined) return;
        backCheck = first;
        if (backCheck.cursor === null) {
          setState((prev) =>
            prev.chatId === selectedId && prev.attachment === attachment
              ? { ...prev, items: dropChunk(prev.items, messageId) }
              : prev,
          );
          return;
        }
        cursor = backCheck.cursor;
      } else {
        cursor = continuationCursor(row, chunks);
      }
      if (!cursor) return;
      const revision = existing?.revision ?? row.textRevision;
      const token = `${scope}:${generation}:${revision}:${++requestIdRef.current}`;
      guard.latest.set(messageId, token);
      guard.busy.set(messageId, token);
      setLoadingState({ scope, messageId, token });
      setFailure(null);
      const controller = new AbortController();
      guard.controllers.add(controller);
      const owned = () =>
        scopeRef.current === scope &&
        generationRef.current === generation &&
        guard.busy.get(messageId) === token &&
        guard.latest.get(messageId) === token &&
        !controller.signal.aborted;
      const fresh = () =>
        scopeRef.current === scope &&
        generationRef.current === generation &&
        guard.latest.get(messageId) === token &&
        !controller.signal.aborted;
      try {
        const page = await getMessageText(selectedId, messageId, cursor, controller.signal);
        if (!owned() || page.messageId !== messageId) return;
        const applyTo = (base: ChunkState): ChunkState => {
          const items = reconcileChunks(base.items, rowsRef.current);
          const current = rowsRef.current.find((message) => message.id === messageId);
          if (!current || current.textRevision !== page.textRevision) return base;
          const invalid =
            mode === "next"
              ? continuationCursor(current, items) !== cursor
              : chunkFor(current, items)?.back[0]?.cursor !== backCheck?.cursor;
          if (invalid) return base;
          const force = mode === "next" && atSectionLimit(items, messageId);
          const nextItems =
            mode === "back" && backCheck
              ? backSection(items, page, cursor, backCheck.prefix, backCheck.initial)
              : appendSection(items, page, cursor, current.text, force);
          const evicted = evictChunks(
            nextItems,
            budgetRef.current,
            (id) => commitOrder(id)?.[0] ?? 0,
          );
          return { ...base, items: evicted.chunks, bytes: evicted.bytes };
        };
        setState((previous) => (fresh() ? applyTo(previous) : previous));
      } catch (caught) {
        const latestRow = rowsRef.current.find((message) => message.id === messageId);
        if (owned() && latestRow && latestRow.textRevision === revision) {
          setFailure({ chatId: selectedId, attachment, message: errorMessage(caught) });
        }
      } finally {
        guard.controllers.delete(controller);
        if (guard.busy.get(messageId) === token) guard.busy.delete(messageId);
        // Loading ownership survives provenance pruning; an old token cannot release a new read.
        setLoadingState((value) => (value?.token === token ? null : value));
      }
    },
    [attachment, chunks, scope, selectedId],
  );
  const foreign =
    failure !== null &&
    (failure.chatId !== (selectedId ?? "") || failure.attachment !== attachment);
  const error = foreign ? null : (failure?.message ?? null);
  return { chunks, loadingId, error, request };
}
