import type { ChatMessage } from "@/lib/chat-api";
import type { Position } from "@/lib/chat-history-types";

export const ROW_LIMIT = 400;
/** Page rows reserve the snapshot window (80) plus one live row inside 400. */
export const PAGE_ROW_LIMIT = 319;

const committedPattern = /^(\d+):(\d+)$/;

export function commitOrder(id: string): [number, number] | null {
  const match = committedPattern.exec(id);
  if (!match) return null;
  const entryId = Number(match[1]);
  const modelIndex = Number(match[2]);
  return Number.isSafeInteger(entryId) && Number.isSafeInteger(modelIndex)
    ? [entryId, modelIndex]
    : null;
}

export const isCommitted = (message: ChatMessage) => commitOrder(message.id) !== null;

function compareRows(a: ChatMessage, b: ChatMessage): number {
  const left = commitOrder(a.id);
  const right = commitOrder(b.id);
  if (left && right) return left[0] - right[0] || left[1] - right[1];
  if (left) return -1;
  if (right) return 1;
  return a.createdAt.localeCompare(b.createdAt);
}

function keepRicher(current: ChatMessage, incoming: ChatMessage): ChatMessage {
  if (
    current.textRevision === incoming.textRevision &&
    current.text.length >= incoming.text.length
  ) {
    return {
      ...incoming,
      text: current.text,
      textState: current.textState,
      textCursor: current.textCursor,
    };
  }
  return incoming;
}

/**
 * Deduplicates committed identities and orders by numeric entry/model pair.
 * A smaller preview never replaces an already fetched longer prefix of the
 * same revision; a changed live revision replaces its row entirely.
 */
export function mergeRows(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((row) => [row.id, row]));
  for (const message of incoming) {
    const existing = byId.get(message.id);
    if (!existing) byId.set(message.id, message);
    else if (isCommitted(message)) byId.set(message.id, keepRicher(existing, message));
    else byId.set(message.id, message);
  }
  return [...byId.values()].toSorted(compareRows);
}

/** Bounded retained range; `oldest` keeps read progress while paging older. */
export function capRows(
  rows: ChatMessage[],
  state: { olderUnloaded: boolean; newerUnloaded: boolean },
  direction: "newest" | "oldest",
  limit = ROW_LIMIT,
) {
  if (rows.length <= limit) {
    return { rows, olderUnloaded: state.olderUnloaded, newerUnloaded: state.newerUnloaded };
  }
  if (direction === "oldest") {
    return {
      rows: rows.slice(0, limit),
      olderUnloaded: state.olderUnloaded,
      newerUnloaded: true,
    };
  }
  return {
    rows: rows.slice(rows.length - limit),
    olderUnloaded: true,
    newerUnloaded: state.newerUnloaded,
  };
}

export function comparePositions(a: Position | null, b: Position | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.entryId - b.entryId || a.modelIndex - b.modelIndex;
}

export const lowerPosition = (a: Position | null, b: Position | null) =>
  comparePositions(a, b) <= 0 ? a : b;
