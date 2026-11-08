import type { ImageContent, Message, TextContent, Usage } from "@earendil-works/pi-ai";
import { Message as WireMessage } from "@highchat/chat-runtime";
import { Schema } from "effect";

export const ROOT_CONVERSATION_ID = 1;
export type EntryId = number;
export type ConversationId = number;
export type UserInput = string | readonly (TextContent | ImageContent)[];
export const EntryRecord = Schema.Struct({
  id: Schema.Number,
  conversationId: Schema.Number,
  kind: Schema.String,
  operationId: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.Array(WireMessage)),
  data: Schema.optionalKey(Schema.Unknown),
  head: Schema.optionalKey(Schema.Number),
  edits: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        target: Schema.Number,
        action: Schema.Literals(["omit", "replace"]),
        messages: Schema.optionalKey(Schema.Array(WireMessage)),
      }),
    ),
  ),
});
export type EntryRecord = typeof EntryRecord.Type;
/** The persisted kind names remain compatible with already saved public history. */
export const UserEntry = { kind: "pi.user", is: (entry: EntryRecord) => entry.kind === "pi.user" };
export const AssistantEntry = {
  kind: "pi.assistant",
  is: (entry: EntryRecord) => entry.kind === "pi.assistant",
};
export const ToolResultEntry = {
  kind: "pi.tool-result",
  is: (entry: EntryRecord) => entry.kind === "pi.tool-result",
};
export const ResetEntry = {
  kind: "pi.reset",
  is: (entry: EntryRecord) => entry.kind === "pi.reset",
};
export const CompactionEntry = {
  kind: "pi.compaction",
  is: (entry: EntryRecord) => entry.kind === "pi.compaction",
};
export type ContextView = {
  readonly entries: readonly EntryRecord[];
  readonly messages: readonly Message[];
};
export type PiContext = {
  readonly abortSignal?: AbortSignal | undefined;
  readonly value: (key: unknown) => unknown;
};
export type ToolSlot = {
  readonly callId: string;
  readonly name: string;
  readonly status: "pending" | "running" | "done";
  readonly output?: string;
};
export type EntryQuery = {
  readonly order: "ascending" | "descending";
  readonly minEntryId?: number;
  readonly maxEntryId?: number;
};
export type EntryCursor = { readonly after: number; readonly order: "ascending" | "descending" };
export type EntryPage = { readonly items: EntryRecord[]; readonly next?: EntryCursor };
export interface Conversation {
  readonly id: number;
  entries(
    query: EntryQuery,
    limit: number,
    cursor: EntryCursor | undefined,
    context: PiContext,
  ): Promise<EntryPage>;
  context(context: PiContext): Promise<ContextView>;
}
export type SubmissionRecord = {
  readonly id: string;
  readonly type: "input";
  readonly conversationId: number;
  readonly requestId: string;
} & (
  | { readonly status: "placed" | "done"; readonly entry: number }
  | { readonly status: "unanswered"; readonly reason: string; readonly entry?: number }
);
export type UsageState = { readonly models: Readonly<Record<string, Usage>> };
