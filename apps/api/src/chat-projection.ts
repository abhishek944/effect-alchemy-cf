import type { Conversation } from "@earendil-works/pi-durable";
import type { PublicChatInput } from "./chat-send-records.ts";
import { publicInputMessage } from "./chat-input-projection.ts";
import { publicInputSelections } from "./chat-input-selections.ts";
import { messageUsage } from "./chat-accounting.ts";
import { storedMessageTime } from "./chat-time.ts";
import { decodeOption } from "./chat-internal.ts";
import {
  FRAME_BYTES,
  MAX_BLOCK_VISITS,
  MAX_ENTRY_FETCHES,
  MAX_MODEL_CANDIDATES,
  InvalidCursor,
  NativeDescending,
  TEXT_PREVIEW_UNITS,
  encodedBytes,
  encodeHistoryCursor,
  type HistoryCursor,
  type HistoryPage,
} from "./chat-contract.ts";
import type { Chat, ChatMessage, Position } from "./chat-model.ts";
import { isEntryId, publicRole, sliceText, textInfo } from "./chat-text.ts";
import { ToolHistory, type LiveToolRound } from "./chat-tool-history.ts";
import { committedRevision } from "./chat-text.ts";
export type PiContext = Parameters<Conversation["configure"]>[1];
export const buildWindow = async (
  conversation: Conversation,
  chat: Chat,
  context: PiContext,
  cursor: HistoryCursor | null,
  limit: number,
  inputForEntry: (entry: number) => Promise<PublicChatInput | null>,
  byteBudget = FRAME_BYTES,
  blockBudget = MAX_BLOCK_VISITS,
  candidateBudget = MAX_MODEL_CANDIDATES,
  hasGeneratedFiles: (entryId: number, modelIndex: number) => boolean = () => false,
  attemptState?: (
    operationId: string,
  ) => { readonly logicalOperationId: string; readonly incomplete: boolean } | null,
  liveTools?: LiveToolRound,
): Promise<HistoryPage> => {
  let ceiling = cursor?.ceiling ?? null;
  let after = cursor?.after ?? null;
  let entryResume = cursor?.entry ?? null;
  let indexResume = cursor?.index ?? null;
  let through: Position | null = null;
  const budget = { fetches: 0, candidates: 0, blocks: 0 };
  const toolHistory = new ToolHistory(
    cursor !== null,
    conversation,
    context,
    budget,
    blockBudget,
    candidateBudget,
  );
  let exhausted = false;
  let used = 4096; // Coverage/cursor/envelope reserve exceeds all bounded v1 metadata.
  const messages: ChatMessage[] = [];
  while (budget.fetches < MAX_ENTRY_FETCHES && messages.length < limit) {
    const max = ceiling !== null && isEntryId(ceiling) ? ceiling : undefined;
    const exact = entryResume !== null && isEntryId(entryResume) ? entryResume : undefined;
    const query =
      exact === undefined
        ? { order: "descending" as const, ...(max === undefined ? {} : { maxEntryId: max }) }
        : { order: "descending" as const, minEntryId: exact, maxEntryId: exact };
    const page = await conversation.entries(
      query,
      1,
      exact === undefined ? (after ?? undefined) : undefined,
      context,
    );
    budget.fetches += 1;
    const entry = page.items[0];
    if (entry === undefined) {
      if (entryResume !== null) throw new InvalidCursor();
      exhausted = true;
      break;
    }
    if (ceiling === null) ceiling = entry.id;
    if (entry.id > ceiling) throw new Error("History ceiling violated");
    const models = entry.model ?? [];
    if (indexResume !== null && indexResume >= models.length) throw new InvalidCursor();
    const start = indexResume ?? models.length - 1;
    const role = publicRole(entry);
    const input = await inputForEntry(entry.id);
    const attempt =
      input === null || attemptState === undefined ? null : attemptState(input.operationId);
    const attemptOf =
      attempt !== null && input !== null && attempt.logicalOperationId !== input.operationId
        ? attempt.logicalOperationId
        : null;
    const incomplete = role === "assistant" && attempt?.incomplete === true;
    // Retry copies retain one logical command; answers carry the attempts.
    const groupedCopy =
      role === "user" &&
      input !== null &&
      input.logicalOperationId !== null &&
      input.logicalOperationId !== input.operationId;
    let finished = true;
    for (let i = start; i >= 0; i -= 1) {
      if (
        budget.candidates >= candidateBudget ||
        budget.blocks >= blockBudget ||
        messages.length >= limit
      ) {
        entryResume = entry.id;
        indexResume = i;
        finished = false;
        break;
      }
      budget.candidates += 1;
      if (groupedCopy) {
        through = { entryId: entry.id, modelIndex: i };
        continue;
      }
      const message = models[i];
      if (message === undefined || role === null || message.role !== role) {
        if (message !== undefined) toolHistory.observe(entry, message);
        through = { entryId: entry.id, modelIndex: i };
        continue;
      }
      const units = Math.min(TEXT_PREVIEW_UNITS, Math.floor((byteBudget - used - 1024) / 6));
      if (units < 2) {
        entryResume = entry.id;
        indexResume = i;
        finished = false;
        break;
      }
      const source = publicInputMessage(message, role === "user" ? input : null);
      const slice = sliceText(source, 0, 0, units, blockBudget - budget.blocks);
      budget.blocks += slice.visited;
      const available = Math.max(0, byteBudget - used - 1024 - slice.text.length * 6);
      const tools =
        message.role === "assistant"
          ? await toolHistory.project(entry, message, ceiling, available, liveTools)
          : {};
      const id = `${entry.id}:${i}`;
      const candidate: ChatMessage = {
        id,
        role,
        text: slice.text,
        createdAt: storedMessageTime(message.timestamp),
        operationId: input?.operationId ?? null,
        attachments: input?.files ?? [],
        selectedAreas: publicInputSelections(source, input?.accepted ?? null),
        attemptOf,
        incomplete,
        hasGeneratedFiles: role === "assistant" && hasGeneratedFiles(entry.id, i),
        usage: message.role === "assistant" ? messageUsage(message) : null,
        ...textInfo(chat.id, id, committedRevision(entry.id, role), slice),
        ...tools,
      };
      const size = encodedBytes(candidate) + 1;
      if (used + size > byteBudget) {
        entryResume = entry.id;
        indexResume = i;
        finished = false;
        break;
      }
      messages.push(candidate);
      used += size;
      through = { entryId: entry.id, modelIndex: i };
    }
    if (!finished) break;
    toolHistory.finish(entry);
    entryResume = null;
    indexResume = null;
    through = { entryId: entry.id, modelIndex: 0 };
    if (exact !== undefined) after = { after: entry.id, order: "descending" };
    else if (page.next === undefined) {
      exhausted = true;
      break;
    } else {
      const next = decodeOption(NativeDescending, page.next);
      if (next === null || next.after !== entry.id) throw new Error("Unexpected native cursor");
      after = next;
    }
  }
  const result: HistoryPage = {
    messages: messages.toReversed(),
    history: {
      ceilingEntryId: ceiling,
      through,
      historyCursor:
        exhausted || ceiling === null
          ? null
          : encodeHistoryCursor({
              v: 1,
              k: "h",
              chat: chat.id,
              ceiling,
              after,
              entry: entryResume,
              index: indexResume,
            }),
    },
  };
  if (encodedBytes(result) > byteBudget) throw new Error("History byte budget exceeded");
  return result;
};
