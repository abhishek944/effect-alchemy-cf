import { ChatApiError, unexpectedResponse } from "./chat-api";
import { isUuid } from "./chat-validate-base";
import { nativeImageMessageId } from "./image-usage-guards";
import { parseImageUsage } from "./image-usage-validate";
import type { ImageUsagePresentation } from "./image-usage-types";

/** Private read only: lifetime totals plus bounded safe recent, never provider dispatch. */
export async function getImageUsage(
  chatId: string,
  messageId?: string,
  signal?: AbortSignal,
): Promise<ImageUsagePresentation> {
  if (!isUuid(chatId) || (messageId !== undefined && !nativeImageMessageId(messageId)))
    throw new Error("Invalid image usage identity.");
  const query = messageId === undefined ? "" : `?${new URLSearchParams({ messageId })}`;
  const timeout = AbortSignal.timeout(15_000);
  const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/images/usage${query}`, {
    method: "GET",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    await response.body?.cancel();
    const message =
      response.status === 401
        ? "Sign in again to read image costs."
        : response.status === 403
          ? "Image cost reads are blocked for this account."
          : response.status === 404
            ? "Image cost records are not available for this chat or response."
            : "Image costs could not be read. Retry only reloads stored accounting.";
    throw new ChatApiError(response.status, message);
  }
  if (
    !response.body ||
    response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json"
  ) {
    await response.body?.cancel();
    throw unexpectedResponse();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 131_072) throw unexpectedResponse();
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw unexpectedResponse();
  }
  const value = parseImageUsage(raw, messageId);
  if (!value) throw unexpectedResponse();
  return value;
}
