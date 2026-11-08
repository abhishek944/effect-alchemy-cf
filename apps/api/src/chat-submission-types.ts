import type { FailureContext } from "@highchat/diagnostics";
import type { UserInput } from "./chat-transcript-types.ts";
import type { FileDescriptor } from "./chat-attachment-schema.ts";
import type { Chat } from "./chat-model.ts";

export type ChatSendScope = {
  readonly chat: Chat;
  readonly ownerId: string;
  readonly applicationOrigin: string;
};
export type PreparedChatSend = {
  readonly content: UserInput;
  readonly files: readonly FileDescriptor[];
};
export type SendObservation = Pick<FailureContext, "requestId">;
export type SendProgress = { phase: string; outcome: FailureContext["outcome"] };
