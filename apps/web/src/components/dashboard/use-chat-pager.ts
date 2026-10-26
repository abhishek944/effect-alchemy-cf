import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage, type ChatMessage } from "@/lib/chat-api";
import { getHistory } from "@/lib/chat-history-api";
import type { Position } from "@/lib/chat-history-types";
import { applyPage, emptyPageState, retainPage, type PageState } from "./chat-history";

const PAGE_SIZE = 40;

type ScopedError = { chatId: string; attachment: string; message: string };
type LoadingState = { scope: string; mode: "older" | "missing" };
type Guard = {
  request: number;
  latest: number;
  generation: number;
  controllers: Set<AbortController>;
};
type Ack = { chatId: string; generation: number; version: number; ids: string[] };

/**
 * Bounded paging with commit-synchronous scope/generation ownership. The
 * network-busy marker is released in `finally`, while the latest application
 * token stays valid until superseded or invalidated by cleanup, so a deferred
 * state updater still applies its validated page. Operation UUIDs are
 * acknowledged only after commit, from committed rows of the source chat.
 */
export function useChatPager(
  selectedId: string | null,
  attachment: string,
  onOperations: ((chatId: string, ids: string[]) => void) | undefined,
  snapshotRows: ChatMessage[],
) {
  const scope = `${selectedId ?? ""}:${attachment}`;
  const [state, setState] = useState<PageState>(() => emptyPageState(selectedId ?? "", attachment));
  const retained = retainPage(state, snapshotRows);
  if (retained !== state) setState(retained);
  const [loadingState, setLoadingState] = useState<LoadingState | null>(null);
  const [failure, setFailure] = useState<ScopedError | null>(null);
  const [ackVersion, setAckVersion] = useState(0);
  const ackRef = useRef<Ack | null>(null);
  const ackVersionRef = useRef(0);
  const requestIdRef = useRef(0);
  const guardRef = useRef<Guard>({
    request: 0,
    latest: 0,
    generation: 0,
    controllers: new Set(),
  });
  const scopeRef = useRef(scope);
  const stateRef = useRef(retained);
  const snapshotRowsRef = useRef(snapshotRows);

  useLayoutEffect(() => {
    stateRef.current = retained;
    snapshotRowsRef.current = snapshotRows;
  }, [retained, snapshotRows]);

  useLayoutEffect(() => {
    const guard = guardRef.current;
    scopeRef.current = scope;
    guard.generation += 1;
    guard.request = 0;
    guard.latest = 0;
    for (const controller of guard.controllers) controller.abort();
    guard.controllers.clear();
    return () => {
      scopeRef.current = "";
      guard.generation += 1;
      guard.request = 0;
      guard.latest = 0;
      for (const controller of guard.controllers) controller.abort();
      guard.controllers.clear();
    };
  }, [scope]);

  useEffect(() => {
    const ack = ackRef.current;
    if (!ack || ack.version !== ackVersion || !onOperations) return;
    ackRef.current = null;
    if (scopeRef.current !== scope || guardRef.current.generation !== ack.generation) return;
    const rows = stateRef.current.rows;
    const ids = ack.ids.filter((id) => rows.some((row) => row.operationId === id));
    if (ids.length) onOperations(ack.chatId, ids);
  }, [ackVersion, onOperations, scope]);

  const load = useCallback(
    async (
      cursor: string,
      mode: "older" | "missing",
      chainCeiling: number | null,
      bridgeTarget: Position | null,
    ) => {
      const guard = guardRef.current;
      const generation = guard.generation;
      if (!selectedId || !cursor || guard.request || scopeRef.current !== scope) return;
      const token = ++requestIdRef.current;
      guard.request = token;
      guard.latest = token;
      setLoadingState({ scope, mode });
      setFailure(null);
      const controller = new AbortController();
      guard.controllers.add(controller);
      const owned = () =>
        scopeRef.current === scope &&
        guard.generation === generation &&
        guard.request === token &&
        guard.latest === token &&
        !controller.signal.aborted;
      const current = () =>
        scopeRef.current === scope &&
        guard.generation === generation &&
        guard.latest === token &&
        !controller.signal.aborted;
      const scopedState = (source: PageState) =>
        source.chatId === selectedId && source.attachment === attachment
          ? source
          : emptyPageState(selectedId, attachment);
      try {
        const page = await getHistory(selectedId, cursor, PAGE_SIZE, controller.signal);
        if (!owned()) return;
        const base = scopedState(stateRef.current);
        const sameChain =
          base.ceilingEntryId === null ||
          chainCeiling === null ||
          base.ceilingEntryId === chainCeiling;
        if (base.started && sameChain && base.cursor !== cursor) return;
        if (
          applyPage(
            base,
            page,
            chainCeiling ?? base.ceilingEntryId,
            bridgeTarget,
            snapshotRowsRef.current,
          ) === base
        ) {
          return;
        }
        setState((previous) => {
          if (!current()) return previous;
          const source = scopedState(previous);
          return applyPage(
            source,
            page,
            chainCeiling ?? source.ceilingEntryId,
            bridgeTarget,
            snapshotRowsRef.current,
          );
        });
        const version = ++ackVersionRef.current;
        ackRef.current = {
          chatId: selectedId,
          generation,
          version,
          ids: page.messages
            .map((message) => message.operationId)
            .filter((id): id is string => Boolean(id)),
        };
        setAckVersion(version);
      } catch (caught) {
        if (!owned()) return;
        setFailure({ chatId: selectedId, attachment, message: errorMessage(caught) });
      } finally {
        guard.controllers.delete(controller);
        if (guard.request === token) {
          guard.request = 0;
          setLoadingState((value) => (value && value.scope === scope ? null : value));
        }
      }
    },
    [attachment, scope, selectedId],
  );

  const returnToLatest = useCallback(() => {
    if (scopeRef.current !== scope) return;
    const guard = guardRef.current;
    guard.generation += 1;
    guard.request = 0;
    guard.latest = 0;
    ackRef.current = null;
    for (const controller of guard.controllers) controller.abort();
    guard.controllers.clear();
    setLoadingState(null);
    setFailure(null);
    setState(emptyPageState(selectedId ?? "", attachment));
  }, [attachment, scope, selectedId]);

  const loading = loadingState && loadingState.scope === scope ? loadingState.mode : null;
  const error =
    failure && failure.chatId === (selectedId ?? "") && failure.attachment === attachment
      ? failure.message
      : null;

  return { state: retained, loading, error, load, returnToLatest };
}
