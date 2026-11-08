import type { Context, Message, UserMessage } from "@earendil-works/pi-ai";
import type { ImageResponseCandidate } from "./chat-image-response-schema.ts";
import type { ChatImageResponseStore } from "./chat-image-response-store.ts";
import type { EntryRecord } from "./chat-transcript-types.ts";

export const compactPrompt = (message: UserMessage): string =>
  typeof message.content === "string"
    ? message.content
    : message.content
        .map((block) => {
          if (block.type !== "text")
            throw new Error("New input must contain compact metadata, not original bytes");
          return block.text;
        })
        .join("\n");

/** Old instruction results stay in visible history, but are not standing guidance on a new Send. */
export const nextRunHistory = (messages: readonly Message[]): Message[] =>
  messages
    .filter((message) => message.role !== "system")
    .map((message) =>
      message.role === "toolResult" && message.toolName === "skill"
        ? {
            ...message,
            content: [
              {
                type: "text",
                text: "Earlier skill instructions are retired. Activate the current approved version with skill(name).",
              },
            ],
            details: null,
          }
        : message,
    );

/** Joins provider-context messages to immutable server entries; model text grants no file authority. */
export const acceptedContextInputs = (input: {
  readonly context: Context;
  readonly entries: readonly EntryRecord[];
  readonly currentEntry: number;
  readonly inputTimestamp: number | undefined;
  readonly responses: ChatImageResponseStore;
}): {
  context: Context;
  accepted: { requestIndex: number; candidate: ImageResponseCandidate }[];
} => {
  const accepted: { requestIndex: number; candidate: ImageResponseCandidate }[] = [];
  const messages = input.context.messages.map((message, requestIndex): Message => {
    if (message.role !== "user") return message;
    const current = message.timestamp === input.inputTimestamp;
    const entry = input.entries.find((storedEntry) =>
      storedEntry.model?.some(
        (stored) =>
          stored.role === "user" &&
          (current
            ? storedEntry.id === input.currentEntry &&
              compactPrompt(stored) ===
                (typeof message.content === "string" ? message.content : compactPrompt(message))
            : stored.timestamp === message.timestamp &&
              JSON.stringify(stored.content) === JSON.stringify(message.content)),
      ),
    );
    if (entry === undefined) return message; // A genuine SDK compaction summary has no original-file authority.
    const stored = entry.model?.find((value) => value.role === "user");
    if (stored?.role !== "user") throw new Error("Accepted input entry is unavailable");
    const bound = input.responses.forEntry(String(entry.conversationId), entry.id, 0);
    if (bound === null) {
      const compact =
        Array.isArray(stored.content) &&
        stored.content.some(
          (block) => block.type === "text" && block.text.startsWith("Referenced files:"),
        );
      if (compact) throw new Error("Accepted original metadata is unavailable");
      return message;
    }
    accepted.push({ requestIndex, candidate: bound.candidate });
    return { ...message, content: stored.content };
  });
  return { context: { ...input.context, messages }, accepted };
};
