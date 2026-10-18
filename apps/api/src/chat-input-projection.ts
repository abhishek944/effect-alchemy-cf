import type { Message } from "@earendil-works/pi-ai";
import { UserEntry, type EntryRecord } from "@earendil-works/pi-durable";
import { RefreshFence } from "./chat-contract.ts";
import type { ChatSendRecords, PublicChatInput } from "./chat-send-records.ts";

/** Quoted file bodies belong in provider context, not in the visible draft caption. */
export const publicInputMessage = (message: Message, input: PublicChatInput | null): Message => {
  if (message.role !== "user") return message;
  // Structured file inputs must wait for their durable metadata mapping, never expose quoted originals.
  if (Array.isArray(message.content) && (input === null || input.textLength === null))
    throw new RefreshFence();
  if (input === null || input.files.length === 0) return message;
  if (input.textLength === 0) return { ...message, content: "" };
  const first = Array.isArray(message.content) ? message.content[0] : undefined;
  if (first?.type !== "text" || first.text.length !== input.textLength)
    throw new Error("Stored attachment caption does not match native input");
  return { ...message, content: first.text };
};

export const publicInputEntry = (entry: EntryRecord, records: ChatSendRecords): EntryRecord => {
  if (entry.kind !== UserEntry.kind || entry.model === undefined) return entry;
  const input = records.forEntry(entry.id);
  return { ...entry, model: entry.model.map((message) => publicInputMessage(message, input)) };
};
