import type { Message } from "@earendil-works/pi-ai";
import { UserEntry, type EntryRecord } from "@earendil-works/pi-durable";
import { RefreshFence } from "./chat-contract.ts";
import type { ChatSendRecords, PublicChatInput } from "./chat-send-records.ts";
import type { AcceptedInputRecord } from "./chat-accepted-input-schema.ts";

export function acceptedPublicInput(
  input: PublicChatInput | null,
  accepted: AcceptedInputRecord | null,
): PublicChatInput | null {
  if (input === null) return null;
  if (accepted !== null && accepted.operationId !== input.operationId)
    throw new Error("Stored accepted input does not match send");
  return { ...input, accepted };
}

/** Structured context belongs to the provider, even when a Send contains no files. */
export const publicInputMessage = (message: Message, input: PublicChatInput | null): Message => {
  if (message.role !== "user") return message;
  // Structured file inputs must wait for their durable metadata mapping, never expose quoted originals.
  if (Array.isArray(message.content) && (input === null || input.textLength === null))
    throw new RefreshFence();
  if (input === null || input.textLength === null) return message;
  if (input.textLength === 0) return { ...message, content: "" };
  const caption =
    typeof message.content === "string"
      ? message.content
      : message.content[0]?.type === "text"
        ? message.content[0].text
        : null;
  if (caption === null || caption.length !== input.textLength)
    throw new Error("Stored caption does not match native input");
  return { ...message, content: caption };
};

export const publicInputEntry = (entry: EntryRecord, records: ChatSendRecords): EntryRecord => {
  if (entry.kind !== UserEntry.kind || entry.model === undefined) return entry;
  const input = records.forEntry(entry.id);
  return { ...entry, model: entry.model.map((message) => publicInputMessage(message, input)) };
};
