import type { ImageContent, TextContent, TSchema } from "@earendil-works/pi-ai";

/** Authority is selected by the object, never by model-supplied arguments. */
export type ChatToolScope = {
  readonly operationId: string;
  readonly ownerId: string;
  readonly chatId: string;
  readonly chatScope: string;
  readonly conversationId: string;
  readonly callId: string;
  readonly assistantEntry: number;
  readonly signal: AbortSignal;
};
export type ChatToolResult = {
  content: (TextContent | ImageContent)[];
  details: unknown;
  isError?: boolean;
};
export type ChatSdkTool = {
  readonly name: string;
  readonly description: string;
  readonly parameters: TSchema;
  readonly execute: (input: unknown, scope: ChatToolScope) => Promise<ChatToolResult>;
};
export const sdkToolText = (value: unknown, isError = false): ChatToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  details: value,
  isError,
});
