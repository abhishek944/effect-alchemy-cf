import type { ChatSnapshot } from "@/lib/chat-api";
import type { ChatFilesControls, PendingSend, StopTarget } from "@/lib/chat-store-context";

const BUSY = "Another send is waiting for Retry or Discard before a new message can be sent.";
const STOPPING = "An answer is being stopped. Try again once it is acknowledged.";
const NO_SETTINGS = "This chat's model settings are still loading. Try again when they are ready.";
export const MAX_TEXT = 16000;

/** Overlong drafts keep the composer content and explain the exact limit. */
export function textTooLong(text: string): string | null {
  return text.length > MAX_TEXT
    ? `Messages can be at most ${MAX_TEXT} characters; this draft has ${text.length}. It has been kept in the composer.`
    : null;
}

/**
 * Admission rules for one direct Send. A busy or stopped chat is rejected
 * rather than queued, and a missing authoritative selection fails closed.
 */
export function sendBlockReason(input: {
  selectionMatches: boolean;
  pending: PendingSend | null;
  inFlight: boolean;
  stopping: StopTarget | null;
  snapshot: ChatSnapshot | null;
  chatId: string;
  connection: string;
  selectionReady: boolean;
  files: ChatFilesControls;
  text: string;
}): string | null {
  if (!input.selectionMatches) return "This chat is no longer selected. Your draft is kept.";
  if (input.pending || input.inFlight) return BUSY;
  if (input.stopping) return STOPPING;
  if (!input.snapshot || input.snapshot.chat.id !== input.chatId)
    return "This chat is not ready yet. Wait for it to connect.";
  if (input.connection !== "live")
    return "This chat is reconnecting. Your draft is kept until it is ready.";
  if (input.snapshot.chat.archived)
    return "This chat is archived. Unarchive it to send new messages.";
  if (!input.selectionReady) return NO_SETTINGS;
  if (input.files.blockedReason) return input.files.blockedReason;
  if (!input.text && input.files.files.length === 0) return "Enter a message before sending.";
  return null;
}
