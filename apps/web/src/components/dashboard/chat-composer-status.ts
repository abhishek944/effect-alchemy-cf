/** Footer status and Send-button copy for the current connection state. */
import type { ChatConnection } from "@/lib/chat-store-context";

export function composerStatus(input: {
  hasSnapshot: boolean;
  connection: ChatConnection;
  stoppingHere: boolean;
  archived: boolean;
  posting: boolean;
}): string {
  if (!input.hasSnapshot) {
    if (input.connection === "error") return "This chat is not available right now.";
    if (input.connection === "idle") return "Select a chat or start a new one to send messages.";
    return "Connecting to this chat…";
  }
  if (input.stoppingHere) return "Stopping the current answer…";
  if (input.archived) return "This chat is archived. Unarchive it to send new messages.";
  if (input.connection === "error") return "Connection lost. Reload this chat to reconnect.";
  if (input.connection === "reconnecting") return "Reconnecting ...";
  if (input.connection === "connecting")
    return "Connecting to this chat… showing saved messages until it is ready.";
  return input.posting ? "Sending…" : "";
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
