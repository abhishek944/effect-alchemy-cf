import {
  AssistantEntry,
  UserEntry,
  type EntryId,
  type EntryRecord,
} from "@earendil-works/pi-durable";
import {
  MAX_BLOCK_VISITS,
  TEXT_BYTES,
  InvalidCursor,
  encodedBytes,
  encodeTextCursor,
  type TextCursor,
  type TextPage,
} from "./chat-contract.ts";

export const isEntryId = (n: number): n is EntryId => Number.isSafeInteger(n) && n > 0;
export const publicRole = (entry: EntryRecord): "user" | "assistant" | null =>
  entry.kind === UserEntry.kind ? "user" : entry.kind === AssistantEntry.kind ? "assistant" : null;
/** Caption projection changes must invalidate cached pre-projection text, including continuations. */
export const committedRevision = (entry: number, role: "user" | "assistant"): string =>
  `${role === "user" ? "caption2:" : ""}e${entry}`;
type Source = { readonly content?: unknown };
export type Slice = {
  text: string;
  next: { block: number; offset: number } | null;
  visited: number;
};
const textBlock = (block: unknown): block is { type: "text"; text: string } =>
  typeof block === "object" &&
  block !== null &&
  "type" in block &&
  block.type === "text" &&
  "text" in block &&
  typeof block.text === "string";
const takeUnits = (text: string, start: number, budget: number): number => {
  let end = Math.min(text.length, start + budget);
  if (
    end > start &&
    end < text.length &&
    /[\uD800-\uDBFF]/.test(text[end - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(text[end] ?? "")
  )
    end -= 1;
  return end - start;
};
export const validPosition = (source: Source, block: number, offset: number): boolean => {
  const content: unknown = source.content;
  if (typeof content === "string") return block === 0 && offset <= content.length;
  if (!Array.isArray(content)) return block === 0 && offset === 0;
  const blocks: readonly unknown[] = content;
  if (block > blocks.length) return false;
  if (block === blocks.length) return offset === 0;
  const selected = blocks[block];
  return textBlock(selected) ? offset <= selected.text.length : offset === 0;
};
/** Visits bounded native blocks and concatenates only bounded text slices. */
export const sliceText = (
  source: Source,
  block: number,
  offset: number,
  units: number,
  budget: number,
): Slice => {
  const content: unknown = source.content;
  if (typeof content === "string") {
    const take = takeUnits(content, offset, units);
    return {
      text: content.slice(offset, offset + take),
      visited: 1,
      next: offset + take < content.length ? { block: 0, offset: offset + take } : null,
    };
  }
  if (!Array.isArray(content)) return { text: "", next: null, visited: 0 };
  const blocks: readonly unknown[] = content;
  let text = "";
  let visited = 0;
  for (let i = block; i < blocks.length; i += 1) {
    const start = i === block ? offset : 0;
    if (visited >= budget) return { text, next: { block: i, offset: start }, visited };
    visited += 1;
    const item = blocks[i];
    if (!textBlock(item)) continue;
    const take = takeUnits(item.text, start, units - text.length);
    text += item.text.slice(start, start + take);
    if (start + take < item.text.length)
      return { text, next: { block: i, offset: start + take }, visited };
    if (text.length >= units)
      return { text, visited, next: i + 1 < blocks.length ? { block: i + 1, offset: 0 } : null };
  }
  return { text, next: null, visited };
};
export const textInfo = (chat: string, message: string, revision: string, slice: Slice) => ({
  textState: slice.next === null ? ("complete" as const) : ("preview" as const),
  textRevision: revision,
  textCursor:
    slice.next === null
      ? null
      : encodeTextCursor({
          v: 1,
          k: "t",
          chat,
          message,
          revision,
          ...slice.next,
        }),
});
export const textPage = (
  chat: string,
  messageId: string,
  revision: string,
  source: Source,
  cursor: TextCursor | null,
): TextPage | null => {
  if (cursor !== null && (cursor.message !== messageId || cursor.revision !== revision))
    return null;
  const block = cursor?.block ?? 0;
  const offset = cursor?.offset ?? 0;
  if (!validPosition(source, block, offset)) return null;
  // Reserve the full envelope, including the largest safe integer continuation.
  const reserved = encodedBytes({
    messageId,
    textRevision: revision,
    text: "",
    nextCursor: encodeTextCursor({
      v: 1,
      k: "t",
      chat,
      message: messageId,
      revision,
      block: Number.MAX_SAFE_INTEGER,
      offset: Number.MAX_SAFE_INTEGER,
    }),
  });
  const units = Math.floor((TEXT_BYTES - reserved) / 6);
  if (units < 2) throw new Error("Text metadata exceeds budget");
  const slice = sliceText(source, block, offset, units, MAX_BLOCK_VISITS);
  const page = {
    messageId,
    textRevision: revision,
    text: slice.text,
    nextCursor: textInfo(chat, messageId, revision, slice).textCursor,
  };
  if (encodedBytes(page) > TEXT_BYTES) throw new Error("Text budget exceeded");
  return page;
};
export const committedId = (messageId: string): { entry: EntryId; index: number } | null => {
  if (!/^[1-9][0-9]*:(0|[1-9][0-9]*)$/.test(messageId)) return null;
  const [a, b] = messageId.split(":");
  const entry = Number(a);
  const index = Number(b);
  return isEntryId(entry) && Number.isSafeInteger(index) ? { entry, index } : null;
};
export const committedText = async (
  chat: string,
  messageId: string,
  cursor: TextCursor | null,
  load: (id: EntryId) => Promise<EntryRecord | undefined>,
): Promise<TextPage | null> => {
  const position = committedId(messageId);
  if (position === null) return null;
  const entry = await load(position.entry);
  if (entry === undefined) return null;
  const role = publicRole(entry);
  const message = entry.model?.[position.index];
  if (role === null || message === undefined || message.role !== role) return null;
  const page = textPage(chat, messageId, committedRevision(entry.id, role), message, cursor);
  if (page === null) throw new InvalidCursor();
  return page;
};
