import type { Message } from "@earendil-works/pi-ai";
import { estimateChatContext } from "./chat-accounting-context.ts";
import type { ChatAccounting } from "./chat-accounting.ts";
import { ChatSelection } from "./chat-capabilities.ts";
import { TitleUsageBody } from "./chat-external-usage.ts";
import { decodeOption, json, requestBody } from "./chat-internal.ts";
import type { Chat } from "./chat-model.ts";
import type { ChatRuntime } from "./chat-runtime.ts";
import { SpeechUsage } from "./chat-usage-schema.ts";

/** Private counters and context estimates; all model calls are recorded at the provider transport. */
export const conversationUsage = async (
  request: Request,
  chat: Chat,
  runtime: ChatRuntime,
  accounting: ChatAccounting,
  estimateMessages: () => Promise<readonly Message[] | null>,
): Promise<Response | null> => {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/usage") {
    const preferred = request.headers.get("x-chat-selection");
    const parsed: unknown = preferred === null ? null : JSON.parse(decodeURIComponent(preferred));
    const selection = decodeOption(ChatSelection, parsed);
    if (selection === null) return json({ message: "Missing context model" }, 400);
    return json(
      await accounting.usage({ context: estimateChatContext(await estimateMessages(), selection) }),
    );
  }
  if (request.method === "POST" && path === "/usage/title") {
    const body = decodeOption(TitleUsageBody, await requestBody(request));
    if (body === null || !(await runtime.firstAcceptedInput(body.operationId)))
      return json({ message: "Invalid title attribution" }, 400);
    accounting.recordTitle(`title:${body.operationId}`, body.selection, body.response);
    return json({ ok: true });
  }
  if (request.method === "POST" && path === "/usage/speech") {
    const usage = decodeOption(SpeechUsage, await requestBody(request));
    if (usage === null || usage.chatId !== chat.id)
      return json({ message: "Invalid speech attribution" }, 400);
    accounting.recordSpeech(usage);
    return json({ ok: true });
  }
  return null;
};
