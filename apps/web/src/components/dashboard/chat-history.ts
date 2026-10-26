import type { ChatMessage, ChatSnapshot } from "@/lib/chat-api";
import type { HistoryPage, Position } from "@/lib/chat-history-types";
import {
  capRows,
  commitOrder,
  comparePositions,
  isCommitted,
  lowerPosition,
  mergeRows,
  PAGE_ROW_LIMIT,
} from "./chat-history-rows";
import { evictChunks, textBytes, type Items } from "./chat-history-text";
import {
  orderOf,
  pageView,
  type HistoryGap,
  type HistoryView,
  type PageState,
} from "./chat-history-view";

export { emptyPageState } from "./chat-history-view";
export type { HistoryGap, HistoryView, PageState } from "./chat-history-view";

/** Include hidden snapshot/page versions, but count exact shared row objects only once. */
export const historyBudgetRows = (
  pages: ChatMessage[],
  snapshot: ChatMessage[],
  visible: ChatMessage[],
) => [...new Set([...pages, ...snapshot, ...visible])];

/** Page state itself must fit before persistence, even without any continuation chunks. */
export function retainPage(page: PageState, snapshot: ChatMessage[] = []): PageState {
  const capped = capRows(page.rows, page, "oldest", PAGE_ROW_LIMIT, (rows) =>
    historyBudgetRows(
      rows,
      snapshot,
      page.newerUnloaded ? rows : mergeRows(rows, snapshot.filter(isCommitted)),
    ),
  );
  return capped.rows === page.rows ? page : { ...page, ...capped };
}

function deepestBelow(frontier: Position, rows: ChatMessage[]): Position | null {
  let target: Position | null = null;
  for (const row of rows) {
    const order = commitOrder(row.id);
    if (!order) continue;
    const position = { entryId: order[0], modelIndex: order[1] };
    if (comparePositions(position, frontier) >= 0) continue;
    if (!target || comparePositions(position, target) < 0) target = position;
  }
  return target;
}

/**
 * Honest gap evaluation: a gap closes only when this chain's examined frontier
 * reaches the frozen bridge target. An older chain's watermark is never reused
 * for a new ceiling, and an empty public window still provides its coverage.
 */
function evaluateGap(
  frontier: Position | null,
  rows: ChatMessage[],
  pageThrough: Position | null,
  bridgeTarget: Position | null,
): { gap: HistoryGap | null; bridgeTarget: Position | null } {
  if (!frontier) return { gap: null, bridgeTarget: null };
  const deepest = deepestBelow(frontier, rows);
  const target =
    bridgeTarget && (!deepest || comparePositions(bridgeTarget, deepest) <= 0)
      ? bridgeTarget
      : deepest;
  if (!target) return { gap: null, bridgeTarget: null };
  if (pageThrough && comparePositions(pageThrough, target) <= 0) {
    return { gap: null, bridgeTarget: null };
  }
  return { gap: { through: pageThrough }, bridgeTarget: target };
}

function finish(
  view: HistoryView,
  window: ChatMessage[],
  frontier: Position | null,
  chunks: Items,
): HistoryView {
  const capped = capRows(
    mergeRows(view.rows, window),
    { olderUnloaded: view.olderUnloaded, newerUnloaded: view.newerUnloaded },
    "newest",
  );
  const kept = evictChunks(chunks, capped.rows, (id) => commitOrder(id)?.[0] ?? 0);
  const next: HistoryView = {
    ...view,
    window,
    frontier,
    rows: capped.rows,
    olderUnloaded: capped.olderUnloaded,
    newerUnloaded: capped.newerUnloaded,
    chunks: kept.chunks,
    bytes: kept.bytes,
  };
  const evaluated = evaluateGap(frontier, next.rows, next.pageThrough, view.bridgeTarget);
  return { ...next, gap: evaluated.gap, bridgeTarget: evaluated.bridgeTarget };
}

export function applyWindow(page: PageState, window: ChatMessage[], chunks: Items): HistoryView {
  return finish(pageView(page), window, orderOf(window[0]), chunks);
}

/**
 * Merges the newest snapshot window unless the user is reading a frozen older
 * chain. The window's own coverage initializes its frontier; a differently
 * capped chain never inherits the older scan's watermark.
 */
export function applySnapshot(page: PageState, snapshot: ChatSnapshot, chunks: Items): HistoryView {
  const pinned = page.newerUnloaded;
  const committed = snapshot.messages.filter(isCommitted);
  const window = pinned ? [] : committed;
  const sameChain =
    page.ceilingEntryId === null ||
    snapshot.history.ceilingEntryId === null ||
    page.ceilingEntryId === snapshot.history.ceilingEntryId;
  const started = sameChain && page.started;
  const base: HistoryView = {
    ...pageView(page),
    live: pinned ? [] : snapshot.messages.filter((message) => !isCommitted(message)),
    frontier: pinned ? null : (orderOf(window[0]) ?? snapshot.history.through),
    cursor: pinned ? page.cursor : started ? page.cursor : snapshot.history.historyCursor,
    ceilingEntryId: pinned ? page.ceilingEntryId : snapshot.history.ceilingEntryId,
    pageThrough: pinned ? page.pageThrough : sameChain ? page.pageThrough : null,
  };
  return finish(base, window, base.frontier, chunks);
}

/** Applies one successful page from a validated chain; the caller fences scope. */
export function applyPage(
  page: PageState,
  response: HistoryPage,
  chainCeiling: number | null,
  bridgeTarget: Position | null = null,
  snapshot: ChatMessage[] = [],
): PageState {
  const sameChain =
    chainCeiling === null ||
    response.history.ceilingEntryId === null ||
    chainCeiling === response.history.ceilingEntryId;
  if (!sameChain) return page;
  const chainChanged =
    page.ceilingEntryId !== null &&
    response.history.ceilingEntryId !== null &&
    page.ceilingEntryId !== response.history.ceilingEntryId;
  return retainPage(
    {
      ...page,
      rows: mergeRows(page.rows, response.messages.filter(isCommitted)),
      started: true,
      cursor: response.history.historyCursor,
      exhausted: response.history.historyCursor === null,
      ceilingEntryId: response.history.ceilingEntryId ?? page.ceilingEntryId,
      pageThrough: chainChanged
        ? response.history.through
        : lowerPosition(page.pageThrough, response.history.through),
      bridgeTarget: bridgeTarget ?? page.bridgeTarget,
    },
    snapshot,
  );
}

/** Attaches bounded chunks and accounts their bytes against every supplied row. */
export function withChunks(
  view: HistoryView,
  chunks: Items,
  budgetRows: ChatMessage[],
): HistoryView {
  return { ...view, chunks, bytes: textBytes(budgetRows, chunks) };
}
