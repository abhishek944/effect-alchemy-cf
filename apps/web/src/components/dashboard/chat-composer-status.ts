/** Footer status and Send-button copy for the current connection state. */
import type { ChatConnection } from "@/lib/chat-store-context";

export function composerStatus(input: {
  hasSnapshot: boolean;
  connection: ChatConnection;
}): string {
  if (input.connection === "error")
    return input.hasSnapshot
      ? "Connection lost. Reload this chat to reconnect."
      : "This chat is not available right now.";
  if (input.connection === "connecting" || input.connection === "reconnecting")
    return "Connecting...";
  return "";
}

export function composerSendLabel(input: {
  canSend: boolean;
  stoppingHere: boolean;
  pendingHere: boolean;
  running: boolean;
  archived: boolean;
}): string {
  if (input.canSend) return "Send message";
  if (input.stoppingHere) return "Stopping this chat's answer first";
  if (input.pendingHere) return "Finish or discard this chat's send first";
  if (input.running) return "Wait for this chat's answer to finish";
  if (input.archived) return "Unarchive this chat to send";
  return "Sending is unavailable until this chat is connected";
}
