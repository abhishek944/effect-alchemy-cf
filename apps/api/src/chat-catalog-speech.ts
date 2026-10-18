import type { AgentContext } from "agents";
import { Schema } from "effect";
import { DomainUuid } from "./chat-capabilities.ts";
import { decodeOption, json, requestBody } from "./chat-internal.ts";
import {
  SpeechClaimStore,
  SPEECH_CLAIM_KINDS,
  SPEECH_CLAIM_OUTCOMES,
} from "./chat-speech-claims.ts";
import { SpeechUsage } from "./chat-usage-schema.ts";
import { SpeechPreferences } from "./chat-speech-schema.ts";
import type { ChatPreferencesStore } from "./chat-preferences-store.ts";

export const SpeechClaimBody = Schema.Struct({
  userId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  operationId: DomainUuid,
  kind: Schema.Literals(SPEECH_CLAIM_KINDS),
  chatId: Schema.NullOr(DomainUuid),
  playbackId: Schema.NullOr(DomainUuid),
  inputFingerprint: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
});
export const SpeechClaimResult = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), claimId: DomainUuid, preferences: SpeechPreferences }),
  Schema.Struct({
    ok: Schema.Literal(false),
    code: Schema.Literals(["duplicate", "conflict", "busy", "rate_limited", "unavailable"]),
  }),
]);
const SettleBody = Schema.Struct({
  claimId: DomainUuid,
  outcome: Schema.Literals(SPEECH_CLAIM_OUTCOMES),
});

/** Owner-actor speech admission; a consumed operation never pays for a replay. */
export class ChatCatalogSpeech {
  private readonly storage: AgentContext["storage"];
  private readonly claims: SpeechClaimStore;
  constructor(storage: AgentContext["storage"], preferences: ChatPreferencesStore) {
    this.storage = storage;
    this.claims = new SpeechClaimStore(storage, {
      preferences: () => preferences.speech().preferences,
    });
  }

  async handle(request: Request): Promise<Response | null> {
    const route = `${request.method} ${new URL(request.url).pathname}`;
    if (!["POST /speech/claim", "POST /speech/settle", "POST /usage/speech"].includes(route))
      return null;
    const raw = await requestBody(request);
    if (route === "POST /speech/claim") {
      const body = decodeOption(SpeechClaimBody, raw);
      if (body === null || (body.chatId !== null && !this.claims.ownsChat(body.chatId)))
        return json({ message: "Invalid speech operation" }, 400);
      return json(await this.claims.claim(body));
    }
    if (route === "POST /speech/settle") {
      const body = decodeOption(SettleBody, raw);
      if (body === null) return json({ message: "Invalid speech operation" }, 400);
      await this.claims.settle(body.claimId, body.outcome);
      return json({ ok: true });
    }
    const usage = decodeOption(SpeechUsage, raw);
    if (usage === null || usage.chatId !== null)
      return json({ message: "Invalid speech attribution" }, 400);
    // Dictation before a chat exists remains account-attributable, never charged to another chat.
    await this.storage.put(`speech:usage:${usage.operationId}`, usage);
    return json({ ok: true });
  }
}
