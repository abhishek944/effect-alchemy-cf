import { UsageDoc } from "@earendil-works/pi-durable";
import type { ChatAccounting } from "./chat-accounting.ts";
import { ChatSelection } from "./chat-capabilities.ts";
import { TitleUsageBody } from "./chat-external-usage.ts";
import { decodeOption, json, requestBody } from "./chat-internal.ts";
import type { Chat } from "./chat-model.ts";
import { PI_BACKGROUND, type ChatRuntime } from "./chat-runtime.ts";
import { SpeechUsage } from "./chat-usage-schema.ts";

/** Private usage routes contain counters only; Pi remains the transcript owner. */
export const conversationUsage = async (
  request: Request,
  chat: Chat,
  runtime: ChatRuntime,
  accounting: ChatAccounting,
): Promise<Response | null> => {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/usage") {
    await runtime.ensureRoot();
    const preferred = request.headers.get("x-chat-selection");
    const parsed: unknown = preferred === null ? null : JSON.parse(decodeURIComponent(preferred));
    const selection = decodeOption(ChatSelection, parsed);
    if (selection === null) return json({ message: "Missing context model" }, 400);
    const conversation = await runtime.conversation();
    const view = await conversation.context(PI_BACKGROUND);
    const pi = await runtime.pi();
    const nativeUsage = await pi.snapshot(UsageDoc, conversation.id, PI_BACKGROUND);
    return json(
      await accounting.usage({
        selection,
        messages: view.messages,
        nativeUsage: nativeUsage ?? null,
      }),
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
