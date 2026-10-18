import type { ChatMessage } from "@/lib/chat-api";
import type { Position } from "@/lib/chat-history-types";
import { commitOrder } from "./chat-history-rows";
import type { Items } from "./chat-history-text";

export type HistoryGap = { through: Position | null };

export type HistoryView = {
  chatId: string;
  attachment: string;
  window: ChatMessage[];
  rows: ChatMessage[];
  live: ChatMessage[];
  /** Newest window's own examined frontier, or its coverage `through` when empty. */
  frontier: Position | null;
  /** Frozen deepest cached position a bridge scan must reach to close the gap. */
  bridgeTarget: Position | null;
  cursor: string | null;
  ceilingEntryId: number | null;
  pageThrough: Position | null;
  gap: HistoryGap | null;
  olderUnloaded: boolean;
  newerUnloaded: boolean;
  chunks: Items;
  bytes: number;
};

export type PageState = {
  chatId: string;
  attachment: string;
  rows: ChatMessage[];
  started: boolean;
  cursor: string | null;
  exhausted: boolean;
  ceilingEntryId: number | null;
  pageThrough: Position | null;
  bridgeTarget: Position | null;
  olderUnloaded: boolean;
  newerUnloaded: boolean;
};

export const emptyPageState = (chatId: string, attachment: string): PageState => ({
  chatId,
  attachment,
  rows: [],
  started: false,
  cursor: null,
  exhausted: false,
  ceilingEntryId: null,
  pageThrough: null,
  bridgeTarget: null,
  olderUnloaded: false,
  newerUnloaded: false,
});

export const pageView = (state: PageState): HistoryView => ({
  chatId: state.chatId,
  attachment: state.attachment,
  window: [],
  rows: state.rows,
  live: [],
  frontier: null,
  bridgeTarget: state.bridgeTarget,
  cursor: state.started ? state.cursor : null,
  ceilingEntryId: state.ceilingEntryId,
  pageThrough: state.pageThrough,
  gap: null,
  olderUnloaded: state.olderUnloaded,
  newerUnloaded: state.newerUnloaded,
  chunks: {},
  bytes: 0,
});

export function orderOf(message: ChatMessage | undefined): Position | null {
  if (!message) return null;
  const order = commitOrder(message.id);
  return order ? { entryId: order[0], modelIndex: order[1] } : null;
}
