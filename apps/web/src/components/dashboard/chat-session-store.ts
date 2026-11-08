import type { SetStateAction } from "react";
import { retainsSession, type ChatSessionEntry } from "./chat-session-types";

/**
 * Account-scoped registry of retained chat owners. It is a small external store: a hidden owner's
 * frame only notifies when retention actually changes, so a background run never re-renders the
 * conversation on screen. It holds identity only; it creates no work, saves
 * nothing and replays nothing.
 */
export function createChatSessionStore() {
  const entries = new Map<string, ChatSessionEntry>();
  // Error lifetime is the account, not the disposable stream owner.
  const errors = new Map<string | null, string>();
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
    // A callback-only refresh keeps routing current without re-rendering any UI.
    const stateChanged =
      previous === undefined || previous.owner !== next.owner || previous.state !== next.state;
    entries.set(chatId, next);
    if (!stateChanged) return;
    const eligibility =
      previous === undefined || retainsSession(previous.state) !== retainsSession(next.state);
    if (visible || eligibility) emit();
  };
  /** Unmount only, so it never needs to notify: the render that dropped the owner already ran. */
  const remove = (chatId: string, owner: object) => {
    if (entries.get(chatId)?.owner !== owner) return;
    entries.delete(chatId);
  };
  const reload = (chatId: string) => {
    epochs.set(chatId, (epochs.get(chatId) ?? 0) + 1);
    emit();
  };
  const entry = (chatId: string | null) => (chatId === null ? null : (entries.get(chatId) ?? null));
  const epoch = (chatId: string) => epochs.get(chatId) ?? 0;
  const ordered = () => [...entries.entries()];
  const ownerIds = (selectedId: string | null) => {
    const ids: string[] = [];
    if (selectedId !== null) ids.push(selectedId);
    for (const [chatId, session] of entries) {
      if (chatId !== selectedId && session.state.chatId === chatId && retainsSession(session.state))
        ids.push(chatId);
    }
    return ids;
  };
  return {
    subscribe,
    error,
    setError,
    getSnapshot: () => revision,
    publish,
    remove,
    reload,
    entry,
    epoch,
    ordered,
    ownerIds,
  };
}
export type ChatSessionStore = ReturnType<typeof createChatSessionStore>;
