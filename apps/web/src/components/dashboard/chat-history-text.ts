import type { ChatMessage } from "@/lib/chat-api";
import type { TextPage } from "@/lib/chat-history-types";
export const TEXT_BYTES_LIMIT = 2 * 1024 * 1024;
export const SECTION_UNITS = TEXT_BYTES_LIMIT / 2;
export const MAX_SLICE_UNITS = 16384;
export const MAX_BACK_SECTIONS = 8;
export type Items = Record<string, TextChunk>;
export type SectionRef = { cursor: string | null; initial: boolean; prefix: string };
export type TextChunk = {
  messageId: string;
  revision: string;
  /** Prefix length this continuation was fetched against. */
  baseLength: number;
  /** Evolving display prefix paired with this continuation. */
  prefix: string;
  /** Exact prefix paired with `sectionStart`; never evolved by prefix growth. */
  startPrefix: string;
  text: string;
  nextCursor: string | null;
  initial: boolean;
  sectionStart: string | null;
  back: SectionRef[];
};
function startSection(
  chunks: Items,
  page: TextPage,
  requested: string,
  prefix: string,
  initial: boolean,
  back: SectionRef[],
): Items {
  return {
    ...chunks,
    [page.messageId]: {
      messageId: page.messageId,
      revision: page.textRevision,
      baseLength: initial ? prefix.length : 0,
      prefix: initial ? prefix : "",
      startPrefix: initial ? prefix : "",
      text: page.text,
      nextCursor: page.nextCursor,
      initial,
      sectionStart: requested,
      back: back.slice(0, MAX_BACK_SECTIONS),
    },
  };
}
export function appendSection(
  chunks: Items,
  page: TextPage,
  requested: string,
  prefix: string,
  forceSection: boolean,
): Items {
  const existing = chunks[page.messageId];
  if (!existing || existing.revision !== page.textRevision) {
    return startSection(chunks, page, requested, prefix, true, [
      { cursor: null, initial: true, prefix: "" },
    ]);
  }
  if (forceSection || existing.text.length + page.text.length > SECTION_UNITS) {
    return startSection(chunks, page, requested, prefix, false, [
      { cursor: existing.sectionStart, initial: existing.initial, prefix: existing.startPrefix },
      ...existing.back,
    ]);
  }
  return {
    ...chunks,
    [page.messageId]: { ...existing, text: existing.text + page.text, nextCursor: page.nextCursor },
  };
}
export function backSection(
  chunks: Items,
  page: TextPage,
  requested: string,
  prefix: string,
  initial: boolean,
): Items {
  const existing = chunks[page.messageId];
  return startSection(
    chunks,
    page,
    requested,
    prefix,
    initial,
    existing ? existing.back.slice(1) : [],
  );
}
export function dropChunk(chunks: Items, messageId: string): Items {
  const next = { ...chunks };
  delete next[messageId];
  return next;
}
export function chunkFor(row: ChatMessage, chunks: Items): TextChunk | null {
  const chunk = chunks[row.id];
  return chunk && chunk.revision === row.textRevision ? chunk : null;
}
export function effectiveText(row: ChatMessage, chunks: Items): string {
  const chunk = chunkFor(row, chunks);
  if (!chunk) return row.text;
  if (!chunk.initial) return chunk.text;
  const prefix = chunk.prefix.length > row.text.length ? chunk.prefix : row.text;
  return prefix + chunk.text;
}
export function continuationCursor(row: ChatMessage, chunks: Items): string | null {
  const chunk = chunkFor(row, chunks);
  return chunk ? chunk.nextCursor : row.textCursor;
}
export function atSectionLimit(chunks: Items, messageId: string): boolean {
  const chunk = chunks[messageId];
  return Boolean(chunk && chunk.text.length + MAX_SLICE_UNITS > SECTION_UNITS);
}
export function canGoBack(chunks: Items, messageId: string): boolean {
  const chunk = chunks[messageId];
  return Boolean(chunk && chunk.back.length > 0);
}
export function isSectioned(chunks: Items, messageId: string): boolean {
  const chunk = chunks[messageId];
  return Boolean(chunk && !chunk.initial);
}
export function hasPrefixSentinel(chunks: Items, messageId: string): boolean {
  const chunk = chunks[messageId];
  return Boolean(chunk && chunk.back.some((ref) => ref.cursor === null));
}
/**
 * Keeps an already fetched continuation with its immutable prefix; growth
 * trims only contiguous overlap and later sections stay independent.
 */
export function reconcileChunks(chunks: Items, rows: ChatMessage[]): Items {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const kept: Items = {};
  for (const [messageId, chunk] of Object.entries(chunks)) {
    const row = byId.get(messageId);
    if (!row || row.textRevision !== chunk.revision) continue;
    if (!chunk.initial) {
      kept[messageId] = chunk;
      continue;
    }
    if (row.text.length < chunk.baseLength) {
      kept[messageId] = chunk;
      continue;
    }
    const grown = row.text.length - chunk.baseLength;
    if (grown === 0) {
      kept[messageId] = chunk.prefix === row.text ? chunk : { ...chunk, prefix: row.text };
      continue;
    }
    if (grown >= chunk.text.length) continue;
    kept[messageId] = {
      ...chunk,
      prefix: row.text,
      baseLength: row.text.length,
      text: chunk.text.slice(grown),
    };
  }
  return kept;
}
export function sameChunks(a: Items, b: Items): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
/** Counts every supplied row prefix plus any continuation in the shared budget. */
export function textBytes(rows: ChatMessage[], chunks: Items): number {
  let units = 0;
  const counted = new Set<string>();
  for (const row of rows) {
    units += row.text.length;
    const chunk = chunks[row.id];
    if (!chunk) continue;
    if (chunk.prefix && chunk.prefix !== row.text) units += chunk.prefix.length;
    if (chunk.startPrefix && chunk.startPrefix !== row.text && chunk.startPrefix !== chunk.prefix) {
      units += chunk.startPrefix.length;
    }
    if (counted.has(row.id)) continue;
    counted.add(row.id);
    units += chunk.text.length;
    for (const ref of chunk.back) units += ref.prefix.length;
  }
  return units * 2;
}
/** Keeps newest chunks first and drops oldest ones until the shared budget is met. */
export function evictChunks(
  chunks: Items,
  rows: ChatMessage[],
  order: (messageId: string) => number,
): { chunks: Items; bytes: number } {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const kept: Items = {};
  for (const [messageId, chunk] of Object.entries(chunks)) {
    if (byId.has(messageId)) kept[messageId] = chunk;
  }
  const oldestFirst = Object.values(kept).toSorted(
    (a, b) => order(a.messageId) - order(b.messageId),
  );
  for (const chunk of oldestFirst) {
    if (textBytes(rows, kept) <= TEXT_BYTES_LIMIT) break;
    delete kept[chunk.messageId];
  }
  return { chunks: kept, bytes: textBytes(rows, kept) };
}
