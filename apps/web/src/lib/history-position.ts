/**
 * Entry index tracking for the leave guard.
 *
 * The browser exposes no history position, so every entry this application creates
 * carries a monotonic index in its own history state. The guard needs that index to
 * undo a native traversal with a compensating traversal: returning to the exact
 * entry it came from, without pushing a duplicate or truncating the forward
 * history. This is a small helper for the existing history-based router, not a
 * routing framework.
 */
const INDEX_KEY = "__effectAlchemyHistoryIndex";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stateRecord = (): Record<string, unknown> => {
  const state: unknown = window.history.state;
  return isRecord(state) ? { ...state } : {};
};

const readIndex = (): number | null => {
  const value = stateRecord()[INDEX_KEY];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
};

/** Index of the current entry; 0 when the entry predates this helper. */
export const currentHistoryIndex = (): number => readIndex() ?? 0;

/** Creates a new entry and stamps it with the next index (truncates forward history). */
export const pushHistoryEntry = (path: string): void => {
  const index = currentHistoryIndex() + 1;
  window.history.pushState({ ...stateRecord(), [INDEX_KEY]: index }, "", path);
};

/** Replaces the current entry, keeping its index. */
export const replaceHistoryEntry = (path: string): void => {
  window.history.replaceState({ ...stateRecord(), [INDEX_KEY]: currentHistoryIndex() }, "", path);
};

/** Relative native traversal, used both to restore the original entry and to proceed. */
export const traverseHistory = (delta: number): void => {
  if (delta !== 0) window.history.go(delta);
};
