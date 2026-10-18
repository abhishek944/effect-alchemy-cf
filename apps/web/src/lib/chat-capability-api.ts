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
import { ChatApiError, errorMessage, request, unexpectedResponse } from "@/lib/chat-api";

export type CapabilityLoadState = "idle" | "loading" | "ready" | "error";

/** Honest wording for an authenticated capability request that failed. */
export function capabilityMessage(error: unknown, action: string): string {
  if (error instanceof ChatApiError) {
    if (error.status === 404)
      return `${action} is not available on this server. Ask the operator to enable it.`;
    if (error.status === 401) return "You are signed out. Sign in again to continue.";
    if (error.status === 403) return `${action} was blocked for this account.`;
  }
  return `${action} failed. ${errorMessage(error)}`;
}

const chatPath = (chatId: string, suffix: string): string =>
  `/api/chats/${encodeURIComponent(chatId)}/${suffix}`;

export async function getChatCatalog(signal?: AbortSignal): Promise<ChatCatalog> {
  const catalog = parseChatCatalog(
    await request("/api/chat/capabilities", signal ? { signal } : undefined),
  );
  if (!catalog) throw unexpectedResponse();
  return catalog;
}

export async function getAccountChatPreferences(): Promise<AccountChatPreferencesView> {
  const view = parseAccountChatPreferencesView(await request("/api/chat/preferences"));
  if (!view) throw unexpectedResponse();
  return view;
}

export async function getChatPreferences(chatId: string): Promise<ChatPreferencesView> {
  const view = parseChatPreferencesView(await request(chatPath(chatId, "preferences")));
  if (!view) throw unexpectedResponse();
  return view;
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
  const result = parseChatPreferencesWriteResult(
    await request(chatPath(chatId, "preferences"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
  if (!result) throw unexpectedResponse();
  return result;
}

export async function getChatUsage(chatId: string): Promise<ChatUsage> {
  const usage = parseChatUsage(await request(chatPath(chatId, "usage")));
  if (!usage) throw unexpectedResponse();
  return usage;
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
  const descriptor = parseChatFileDescriptor(
    await request(chatPath(chatId, `attachments/${encodeURIComponent(attachmentId)}`), {
      method: "POST",
      headers: {
        "content-type": mediaType,
        "x-file-name": encodeURIComponent(name),
      },
      body: file,
    }),
  );
  if (!descriptor) throw unexpectedResponse();
  return descriptor;
}

export function chatAttachmentUrl(chatId: string, attachmentId: string): string {
  return chatPath(chatId, `attachments/${encodeURIComponent(attachmentId)}`);
}

export async function deleteChatAttachment(chatId: string, attachmentId: string): Promise<void> {
  await request(chatPath(chatId, `attachments/${encodeURIComponent(attachmentId)}`), {
    method: "DELETE",
  });
}
