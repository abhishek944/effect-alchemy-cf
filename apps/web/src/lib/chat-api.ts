import type { ChatFileDescriptor } from "@/lib/chat-capability-file-types";
import type { ChatSelection } from "@/lib/chat-capability-types";
import type { ChatUsageAmount } from "@/lib/chat-capability-usage-types";
import type { Coverage, TextInfo } from "@/lib/chat-history-types";
import {
  parseAccepted,
  parseChat,
  parseChatList,
  parseOk,
  parseSnapshotValue,
} from "@/lib/chat-validate";

/** Same-origin chat client for the fixed Pi chat HTTP/SSE contract. */
export type Chat = {
  id: string;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  /** Exact ordered prefix of this message's public text, never an ellipsis. */
  text: string;
  createdAt: string;
  /** Original send operation UUID for public user messages, else null. */
  operationId: string | null;
  /** Staged originals submitted with this user message; empty on replies. */
  attachments: ChatFileDescriptor[];
  /** Message-specific reported/estimated counters; null while streaming or unknown. */
  usage: ChatUsageAmount | null;
} & TextInfo;

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
};

export class ChatApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
  }
}

const statusMessages: Record<number, string> = {
  400: "That request was not valid. Check the message and try again.",
  401: "You are signed out. Sign in again to use chats.",
  403: "This request was blocked. Reload the page and try again.",
  404: "This chat is no longer available.",
  409: "This chat cannot accept that change right now.",
  429: "Too many requests. Wait a moment and try again.",
  503: "The assistant is temporarily unavailable. Try again shortly.",
};

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
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

export async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    ...init,
  });
  if (!response.ok) {
    let message = statusMessages[response.status] ?? `Request failed (${response.status}).`;
    try {
      const body: unknown = await response.json();
      if (
        body &&
        typeof body === "object" &&
        "message" in body &&
        typeof body.message === "string" &&
        body.message.trim()
      ) {
        message = body.message;
      }
    } catch {
      // Keep the safe status message when the body is not JSON.
    }
    throw new ChatApiError(response.status, message);
  }
  if (response.status === 204) return undefined;
  const body: unknown = await response.json();
  return body;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export async function listChats(): Promise<Chat[]> {
  const chats = parseChatList(await request("/api/chats"));
  if (!chats) throw unexpectedResponse();
  return chats;
}

export function unexpectedResponse(): ChatApiError {
  return new ChatApiError(502, "The server returned an unexpected response.");
}

export async function createChat(id: string): Promise<Chat> {
  const chat = parseChat(await request("/api/chats", json({ id })));
  if (!chat) throw unexpectedResponse();
  return chat;
}

export async function updateChat(
  id: string,
  patch: { title?: string; archived?: boolean },
): Promise<Chat> {
  const chat = parseChat(
    await request(`/api/chats/${encodeURIComponent(id)}`, {
      ...json(patch),
      method: "PATCH",
    }),
  );
  if (!chat) throw unexpectedResponse();
  return chat;
}

export async function getSnapshot(id: string, signal: AbortSignal): Promise<ChatSnapshot> {
  const snapshot = parseSnapshotValue(
    await request(`/api/chats/${encodeURIComponent(id)}`, { signal }),
  );
  if (!snapshot) throw unexpectedResponse();
  return snapshot;
}

export async function sendMessage(
  id: string,
  input: {
    operationId: string;
    text: string;
    selection: ChatSelection;
    attachments: string[];
  },
): Promise<{ accepted: boolean }> {
  const accepted = parseAccepted(
    await request(`/api/chats/${encodeURIComponent(id)}/messages`, json(input)),
  );
  if (accepted === null) throw unexpectedResponse();
  return { accepted };
}

export async function stopChat(id: string, operationId: string): Promise<{ ok: true }> {
  const ok = parseOk(
    await request(`/api/chats/${encodeURIComponent(id)}/stop`, json({ operationId })),
  );
  if (!ok) throw unexpectedResponse();
  return { ok: true };
}

export function eventsUrl(id: string): string {
  return `/api/chats/${encodeURIComponent(id)}/events`;
}
