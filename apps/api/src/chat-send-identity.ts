import type { SendMessage } from "./chat-model.ts";

/** Bind retries to the complete immutable send, not today's preferences. */
export const sendIdentity = (input: typeof SendMessage.Type): string =>
  JSON.stringify([
    input.text,
    input.selection.provider,
    input.selection.model,
    input.selection.effort,
    input.attachments,
  ]);
