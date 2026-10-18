import type { ChatMessage } from "@/lib/chat-api";

export type Position = { entryId: number; modelIndex: number };

export type Coverage = {
  ceilingEntryId: number | null;
  through: Position | null;
  historyCursor: string | null;
};

export type TextInfo = {
  textState: "complete" | "preview";
  textRevision: string;
  textCursor: string | null;
};

export type HistoryPage = { messages: ChatMessage[]; history: Coverage };

export type TextPage = {
  messageId: string;
  textRevision: string;
  text: string;
  nextCursor: string | null;
};

export type OperationReceipt = {
  operationId: string;
  accepted: boolean;
  settled: boolean;
  error: string | null;
};
