import type { SetStateAction } from "react";
import { retainsSession, type ChatPanelRequest, type ChatSessionEntry } from "./chat-session-types";

type PanelRequestEntry = { chatId: string; request: ChatPanelRequest };

/**
 * Account-scoped registry of retained chat owners. It is a small external store: a hidden owner's
 * frame only notifies when retention or a panel request actually changes, so a background run
 * never re-renders the conversation on screen. It holds identity only; it creates no work, saves
 * nothing and replays nothing.
 */
export function createChatSessionStore() {
  const entries = new Map<string, ChatSessionEntry>();
  // Error lifetime is the account, not the disposable stream owner.
  const errors = new Map<string | null, string>();
  /** One baseline token per chat: the owner incarnation whose first real snapshot was observed. */
  const baselined = new Map<string, object>();
  const claimed = new Map<string, string | null>();
  const epochs = new Map<string, number>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const emit = () => {
    revision += 1;
    for (const listener of listeners) listener();
  };
  const error = (chatId: string | null) => errors.get(chatId) ?? null;
  const setError = (chatId: string | null, update: SetStateAction<string | null>) => {
    const previous = error(chatId);
    const next = typeof update === "function" ? update(previous) : update;
    if (next === previous) return;
    if (next === null) errors.delete(chatId);
    else errors.set(chatId, next);
    emit();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const publish = (chatId: string, next: ChatSessionEntry, visible: boolean) => {
    const previous = entries.get(chatId);
    const snapshot = next.state.snapshot;
    const requestId = snapshot?.panelRequest?.id ?? null;
    // A null loading publication is not an authoritative baseline. The first real snapshot of
    // each owner incarnation records its current intent as already handled, so a reload or a late
    // first mount never replays old tool intent; later new ids on the same owner still open once.
    if (snapshot !== null && baselined.get(chatId) !== next.owner) {
      baselined.set(chatId, next.owner);
      claimed.set(chatId, requestId);
    }
    // A callback-only refresh keeps routing current without re-rendering any UI.
    const stateChanged =
      previous === undefined || previous.owner !== next.owner || previous.state !== next.state;
    entries.set(chatId, next);
    if (!stateChanged) return;
    const eligibility =
      previous === undefined || retainsSession(previous.state) !== retainsSession(next.state);
    const previousRequest = previous?.state.snapshot?.panelRequest?.id ?? null;
    const newRequest =
      requestId !== null &&
      baselined.get(chatId) === next.owner &&
      claimed.get(chatId) !== requestId &&
      previousRequest !== requestId;
    if (visible || eligibility || newRequest) emit();
  };
  /** Unmount only, so it never needs to notify: the render that dropped the owner already ran. */
  const remove = (chatId: string, owner: object) => {
    if (entries.get(chatId)?.owner !== owner) return;
    entries.delete(chatId);
  };
  const claim = (chatId: string, requestId: string) => {
    if (claimed.get(chatId) === requestId) return;
    claimed.set(chatId, requestId);
    emit();
  };
  const reload = (chatId: string) => {
    epochs.set(chatId, (epochs.get(chatId) ?? 0) + 1);
    emit();
  };
  const entry = (chatId: string | null) => (chatId === null ? null : (entries.get(chatId) ?? null));
  const epoch = (chatId: string) => epochs.get(chatId) ?? 0;
  const ordered = () => [...entries.entries()];
  const panelRequests = (): PanelRequestEntry[] => {
    const pending: PanelRequestEntry[] = [];
    for (const [chatId, session] of entries) {
      const request = session.state.snapshot?.panelRequest;
      if (!request || claimed.get(chatId) === request.id) continue;
      pending.push({ chatId, request });
    }
    return pending;
  };
  const ownerIds = (selectedId: string | null, requests: readonly PanelRequestEntry[]) => {
    const ids: string[] = [];
    if (selectedId !== null) ids.push(selectedId);
    for (const [chatId, session] of entries) {
      if (chatId !== selectedId && session.state.chatId === chatId && retainsSession(session.state))
        ids.push(chatId);
    }
    for (const { chatId } of requests) if (!ids.includes(chatId)) ids.push(chatId);
    return ids;
  };
  return {
    subscribe,
    error,
    setError,
    getSnapshot: () => revision,
    publish,
    remove,
    claim,
    reload,
    entry,
    epoch,
    ordered,
    panelRequests,
    ownerIds,
  };
}
export type ChatSessionStore = ReturnType<typeof createChatSessionStore>;
