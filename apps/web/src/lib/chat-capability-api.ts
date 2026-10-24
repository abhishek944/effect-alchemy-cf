/**
 * Browser client for the authenticated chat capability routes.
 *
 * Every response is parsed by the existing manual validators; an unexpected
 * shape rejects instead of being partially trusted. The platform routes are
 * fixed by the parent and are not invented here: catalog, per-chat and account
 * preferences, usage, and the private attachment endpoint.
 */
import type {
  AccountChatPreferencesView,
  ChatCatalog,
  ChatPreferencesView,
  ChatPreferencesWriteResult,
  ChatSelection,
} from "@/lib/chat-capability-types";
import type { ChatUsage } from "@/lib/chat-capability-usage-types";
import type { ChatFileDescriptor } from "@/lib/chat-capability-file-types";
import { parseChatCatalog } from "@/lib/chat-capability-validate";
import {
  parseAccountChatPreferencesView,
  parseChatPreferencesView,
  parseChatPreferencesWriteResult,
} from "@/lib/chat-capability-preference-validate";
import { parseChatUsage } from "@/lib/chat-capability-usage-validate";
import { parseChatFileDescriptor } from "@/lib/chat-capability-file-validate";
import { ChatApiError, errorMessage, requestJson, requestDecoded } from "@/lib/chat-api";

export type CapabilityLoadState = "idle" | "loading" | "ready" | "error";

/** Honest wording for an authenticated capability request that failed. */
export function capabilityMessage(error: unknown, action: string): string {
  if (error instanceof ChatApiError) {
    if (error.status === 404)
      return `${action} is not available on this server. Ask the operator to enable it. ${error.message}`;
    if (error.status === 401)
      return `You are signed out. Sign in again to continue. ${error.message}`;
    if (error.status === 403) return `${action} was blocked for this account. ${error.message}`;
  }
  return `${action} failed. ${errorMessage(error)}`;
}

const chatPath = (chatId: string, suffix: string): string =>
  `/api/chats/${encodeURIComponent(chatId)}/${suffix}`;

export async function getChatCatalog(signal?: AbortSignal): Promise<ChatCatalog> {
  return requestDecoded(
    "/api/chat/capabilities",
    "chat.capabilities",
    parseChatCatalog,
    signal ? { signal } : undefined,
  );
}

export async function getAccountChatPreferences(): Promise<AccountChatPreferencesView> {
  return requestDecoded(
    "/api/chat/preferences",
    "chat.account-preferences",
    parseAccountChatPreferencesView,
  );
}

export async function getChatPreferences(chatId: string): Promise<ChatPreferencesView> {
  return requestDecoded(
    chatPath(chatId, "preferences"),
    "chat.preferences",
    parseChatPreferencesView,
  );
}

/**
 * Decodes the exact `ChatPreferencesWriteResult` envelope; a bare view is not a
 * compatibility path and is rejected as an unexpected response.
 */
export async function writeChatPreferences(
  chatId: string,
  expectedRevision: number,
  selection: ChatSelection,
): Promise<ChatPreferencesWriteResult> {
  const body = JSON.stringify({ chatId, expectedRevision, selection });
  return requestDecoded(
    chatPath(chatId, "preferences"),
    "chat.preferences-write",
    parseChatPreferencesWriteResult,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body,
    },
  );
}

export async function getChatUsage(chatId: string): Promise<ChatUsage> {
  return requestDecoded(chatPath(chatId, "usage"), "chat.usage", parseChatUsage);
}

/**
 * Uploads one staged original with its raw bytes. The server owns content
 * validation; the browser never declares a media type it did not read from
 * the File, and the filename travels URI-encoded in a header.
 */
export async function uploadChatFile(
  chatId: string,
  attachmentId: string,
  file: File,
  name: string,
  mediaType: string,
): Promise<ChatFileDescriptor> {
  return requestDecoded(
    chatPath(chatId, `attachments/${encodeURIComponent(attachmentId)}`),
    "chat.attachment-upload",
    parseChatFileDescriptor,
    {
      method: "POST",
      headers: {
        "content-type": mediaType,
        "x-file-name": encodeURIComponent(name),
      },
      body: file,
    },
  );
}

export function chatAttachmentUrl(chatId: string, attachmentId: string): string {
  return chatPath(chatId, `attachments/${encodeURIComponent(attachmentId)}`);
}

export async function deleteChatAttachment(chatId: string, attachmentId: string): Promise<void> {
  await requestJson(
    chatPath(chatId, `attachments/${encodeURIComponent(attachmentId)}`),
    "chat.attachment-delete",
    { method: "DELETE" },
  );
}
