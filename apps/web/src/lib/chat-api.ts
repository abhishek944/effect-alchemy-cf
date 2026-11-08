import type { ChatReferenceInputs } from "@highchat/chat-contract";
import type { ChatSelection } from "@/lib/chat-capability-types";
import type { ChatMessage } from "@/lib/chat-message-types";
export type { ChatMessage } from "@/lib/chat-message-types";
import { type ApiErrorTag, readApiErrorBody, statusOfTag } from "@highchat/chat-contract";
import { apiErrorMessage } from "@/lib/api-error";
import { rejectionOf, type NoAdmissionRejection } from "@/lib/chat-api-rejection";
import { readResponseRequestId, serverReference } from "@/lib/browser-diagnostics";
import type { Coverage } from "@/lib/chat-history-types";
import type { SkillRecovery } from "@/lib/chat-skills-api";
import {
  parseAccepted,
  parseChat,
  parseChatList,
  parseOk,
  parseSnapshotValue,
} from "@/lib/chat-validate";
export type Chat = {
  id: string;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};
export type ChatSnapshot = {
  chat: Chat;
  messages: ChatMessage[];
  /** Bounded history coverage for the loaded window. */
  history: Coverage;
  isRunning: boolean;
  /** Admitted input of the current ordinary run, or null when idle. */
  activeOperationId: string | null;
  error: string | null;
  model: string;
  thinking: string;
  /** Source epoch:counter bumped only after a real accounting write. */
  usageRevision: string;
  /** Present only while a pinned skill attempt still needs an explicit recovery action. */
  skillRecovery: SkillRecovery | null;
};
export class ChatApiError extends Error {
  readonly status: number;
  readonly rejection: NoAdmissionRejection | null;
  readonly requestId: string | null;
  readonly reference: string;
  constructor(
    status: number,
    message: string,
    rejection: NoAdmissionRejection | null = null,
    requestId: string | null = null,
    operation = "chat.request",
    responseStatus = status,
  ) {
    super(message);
    this.reference = serverReference(operation, responseStatus, requestId);
    this.name = "ChatApiError";
    this.status = status;
    this.rejection = rejection;
    this.requestId = requestId;
  }
}

export function newOperationId(): string {
  return crypto.randomUUID();
}
export function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The request was cancelled.";
  }
  if (error instanceof ChatApiError) return error.message;
  if (error instanceof TypeError) {
    return "Could not reach the server. Check your connection and try again.";
  }
  return "Something went wrong. Please try again.";
}
/** Per-response metadata only; never shared between requests. */
export type JsonResponse = { body: unknown; requestId: string | null; status: number };
export async function requestJson(
  path: string,
  operation: string,
  init?: RequestInit,
): Promise<JsonResponse> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...init,
  });
  const requestId = readResponseRequestId(response);
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch (cause) {
      if (init?.signal?.aborted) throw cause;
      // Keep the safe status message when the body is not JSON.
    }
    // A server tag is authoritative; a status-only reply keeps the generic copy.
    const tag: ApiErrorTag | null = readApiErrorBody(body)?._tag ?? null;
    const status = tag === null ? response.status : statusOfTag(tag);
    throw new ChatApiError(
      status,
      apiErrorMessage(tag, status),
      rejectionOf(body, response.status),
      requestId,
      operation,
      response.status,
    );
  }
  if (response.status === 204) return { body: undefined, requestId, status: response.status };
  try {
    return { body: await response.json(), requestId, status: response.status };
  } catch (cause) {
    if (init?.signal?.aborted) throw cause;
    throw unexpectedResponse(requestId, operation, response.status);
  }
}
export const request = (path: string, init?: RequestInit): Promise<unknown> =>
  requestJson(path, "chat.request", init).then((seen) => seen.body);
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
export const listChats = (): Promise<Chat[]> =>
  requestDecoded("/api/chats", "chat.list", parseChatList);
export const unexpectedResponse = (
  requestId: string | null = null,
  operation = "chat.request",
  responseStatus = 502,
): ChatApiError =>
  new ChatApiError(
    502,
    "Unable to complete your request. Please try again.",
    null,
    requestId,
    operation,
    responseStatus,
  );

export async function requestDecoded<T>(
  path: string,
  operation: string,
  parse: (body: unknown) => T | null,
  init?: RequestInit,
): Promise<T> {
  const { body, requestId, status } = await requestJson(path, operation, init);
  const value = parse(body);
  if (value === null) throw unexpectedResponse(requestId, operation, status);
  return value;
}
export async function createChat(id: string): Promise<Chat> {
  return requestDecoded("/api/chats", "chat.create", parseChat, json({ id }));
}
type ChatPatch = { title?: string; archived?: boolean };
export async function updateChat(id: string, patch: ChatPatch): Promise<Chat> {
  return requestDecoded(`/api/chats/${encodeURIComponent(id)}`, "chat.update", parseChat, {
    ...json(patch),
    method: "PATCH",
  });
}
export async function getSnapshot(id: string, signal: AbortSignal): Promise<ChatSnapshot> {
  const path = `/api/chats/${encodeURIComponent(id)}`;
  return requestDecoded(path, "chat.snapshot", parseSnapshotValue, { signal });
}

export async function sendMessage(
  id: string,
  input: {
    operationId: string;
    text: string;
    selection: ChatSelection;
    attachments: readonly string[];
    references: readonly string[];
    referenceInputs?: ChatReferenceInputs;
  },
): Promise<{ accepted: boolean }> {
  return requestDecoded(
    `/api/chats/${encodeURIComponent(id)}/messages`,
    "chat.send",
    parseAccepted,
    json(input),
  ).then((accepted) => ({ accepted }));
}
export async function stopChat(id: string, operationId: string): Promise<{ ok: true }> {
  await requestDecoded(
    `/api/chats/${encodeURIComponent(id)}/stop`,
    "chat.stop",
    (body) => (parseOk(body) ? true : null),
    json({ operationId }),
  );
  return { ok: true };
}
export function eventsUrl(id: string): string {
  return `/api/chats/${encodeURIComponent(id)}/events`;
}
