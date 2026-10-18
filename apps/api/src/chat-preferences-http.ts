import { DomainUuid } from "./chat-capabilities.ts";
import {
  publicChatCatalog,
  stageModelPolicy,
  type StageModelPolicy,
} from "./chat-capability-policy.ts";
import { decodeOption, json, requestBody } from "./chat-internal.ts";
import { ChatPreferencesWrite } from "./chat-preference-schema.ts";
import type { ChatPreferencesStore } from "./chat-preferences-store.ts";
import { SpeechPreferencesWrite } from "./chat-speech-schema.ts";

/** Nonsecret server configuration: a JSON array, never a browser-supplied allowlist. */
export const configuredChatPolicy = (raw: unknown): StageModelPolicy => {
  if (typeof raw !== "string" || raw.trim() === "") return stageModelPolicy(null);
  try {
    const parsed: unknown = JSON.parse(raw);
    return stageModelPolicy(parsed);
  } catch {
    return stageModelPolicy(null);
  }
};

/** Private owner-catalog routes; public authentication is owned by API ingress. */
export async function catalogPreferences(
  request: Request,
  store: ChatPreferencesStore,
  policy: StageModelPolicy,
  exists: (chatId: string) => boolean,
): Promise<Response | null> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  if (route === "GET /capabilities") return json(publicChatCatalog(policy));
  if (route === "GET /preferences/account") return json(store.account());
  if (route === "GET /preferences/speech") return json(store.speech());
  if (route === "GET /preferences/chat") {
    const chatId = decodeOption(DomainUuid, url.searchParams.get("id"));
    if (chatId === null) return json({ message: "Invalid chat identity" }, 400);
    return exists(chatId) ? json(store.chat(chatId)) : json({ message: "Not found" }, 404);
  }
  if (route === "PATCH /preferences/chat") {
    const input = decodeOption(ChatPreferencesWrite, await requestBody(request));
    if (input === null) return json({ message: "Invalid preferences" }, 400);
    if (!exists(input.chatId)) return json({ message: "Not found" }, 404);
    const result = store.writeChat(input, policy);
    return result.ok
      ? json(result.value)
      : json(
          {
            message:
              result.code === "revision_conflict"
                ? "Preferences changed in another tab. Refresh before choosing again."
                : "This model or reasoning effort is not available in this stage.",
            code: result.code,
          },
          result.code === "revision_conflict" ? 409 : 400,
        );
  }
  if (route === "PATCH /preferences/speech") {
    const input = decodeOption(SpeechPreferencesWrite, await requestBody(request));
    if (input === null)
      return json({ message: "Choose a compatible speech model and voice." }, 400);
    const result = store.writeSpeech(input);
    return result.ok
      ? json(result.value)
      : json(
          {
            message:
              result.code === "revision_conflict"
                ? "Voice preferences changed. Refresh before saving again."
                : "Choose a compatible speech model and voice.",
            code: result.code,
          },
          result.code === "revision_conflict" ? 409 : 400,
        );
  }
  return null;
}
