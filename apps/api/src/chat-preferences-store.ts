import type { AgentContext } from "agents";
import type { Schema } from "effect";
import { resolveChatSelection, type StageModelPolicy } from "./chat-capability-policy.ts";
import { decodeOption } from "./chat-internal.ts";
import {
  AccountChatPreferences,
  ChatPreferences,
  initialAccountChatPreferences,
  initialChatPreferences,
  withModelEffort,
  type AccountChatPreferencesView,
  type ChatPreferencesView,
  type ChatPreferencesWrite,
  type ChatPreferencesWriteResult,
} from "./chat-preference-schema.ts";
import {
  DEFAULT_SPEECH_PREFERENCES,
  SpeechPreferences,
  type SpeechPreferencesView,
  type SpeechPreferencesWrite,
} from "./chat-speech-schema.ts";
import type { ChatSelectionFailure } from "./chat-capabilities.ts";

type WriteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ChatSelectionFailure | "revision_conflict" };

/** Catalog-local preferences: chat choice and next-chat default commit together. */
export class ChatPreferencesStore {
  private readonly storage: AgentContext["storage"];

  constructor(storage: AgentContext["storage"]) {
    this.storage = storage;
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS chat_preferences (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    )`);
  }

  private read<S extends Schema.ConstraintDecoder<unknown>>(
    key: string,
    schema: S,
  ): S["Type"] | null {
    const row = this.storage.sql
      .exec<{ value: string }>(`SELECT value FROM chat_preferences WHERE key = ?`, key)
      .toArray()[0];
    if (row === undefined) return null;
    const raw: unknown = JSON.parse(row.value);
    const parsed = decodeOption(schema, raw);
    if (parsed === null) throw new Error("Stored chat preferences are invalid");
    return parsed;
  }

  private put(key: string, value: unknown): void {
    this.storage.sql.exec(
      `INSERT INTO chat_preferences (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      JSON.stringify(value),
    );
  }

  account(): AccountChatPreferencesView {
    const stored = this.read("account", AccountChatPreferences);
    return {
      preferences: stored ?? initialAccountChatPreferences(),
      source: stored === null ? "default" : "explicit",
    };
  }

  chat(chatId: string): ChatPreferencesView {
    const stored = this.read(`chat:${chatId}`, ChatPreferences);
    return {
      chatId,
      preferences: stored ?? initialChatPreferences(),
      source: stored === null ? "default" : "explicit",
    };
  }

  /** New chats inherit account defaults; reading preferences does not change them. */
  initializeChat(chatId: string): void {
    if (this.read(`chat:${chatId}`, ChatPreferences) !== null) return;
    this.put(`chat:${chatId}`, {
      ...initialChatPreferences(),
      preferred: this.account().preferences.defaultSelection,
    });
  }

  writeChat(
    input: ChatPreferencesWrite,
    policy: StageModelPolicy,
  ): WriteResult<ChatPreferencesWriteResult> {
    const resolved = resolveChatSelection(policy, input.selection);
    if (!resolved.ok) return resolved;
    return this.storage.transactionSync(() => {
      const current = this.chat(input.chatId).preferences;
      if (
        current.revision !== input.expectedRevision ||
        current.revision === Number.MAX_SAFE_INTEGER
      )
        return { ok: false, code: "revision_conflict" };
      const account = this.account().preferences;
      const changed =
        current.preferred.model !== input.selection.model ||
        current.preferred.effort !== input.selection.effort;
      if (changed && account.revision === Number.MAX_SAFE_INTEGER)
        return { ok: false, code: "revision_conflict" };
      const preferences: ChatPreferences = {
        ...current,
        revision: current.revision + 1,
        preferred: resolved.selection,
        modelEfforts: withModelEffort(current.modelEfforts, resolved.selection),
      };
      this.put(`chat:${input.chatId}`, preferences);
      if (changed)
        this.put("account", {
          ...account,
          revision: account.revision + 1,
          defaultSelection: resolved.selection,
        });
      return {
        ok: true,
        value: {
          view: { chatId: input.chatId, preferences, source: "explicit" },
          accountDefaultUpdated: changed,
        },
      };
    });
  }

  speech(): SpeechPreferencesView {
    // Keep the previous provider's settings intact; OpenRouter starts with its own defaults.
    const stored = this.read("speech:openrouter", SpeechPreferences);
    return {
      preferences: stored ?? { version: 1, revision: 0, ...DEFAULT_SPEECH_PREFERENCES },
      source: stored === null ? "default" : "explicit",
    };
  }

  writeSpeech(input: SpeechPreferencesWrite): WriteResult<SpeechPreferencesView> {
    return this.storage.transactionSync(() => {
      const current = this.speech().preferences;
      if (
        current.revision !== input.expectedRevision ||
        current.revision === Number.MAX_SAFE_INTEGER
      )
        return { ok: false, code: "revision_conflict" };
      const preferences = decodeOption(SpeechPreferences, {
        version: 1,
        revision: current.revision + 1,
        transcriptionModel: input.transcriptionModel,
        speechModel: input.speechModel,
        voice: input.voice,
      });
      if (preferences === null) return { ok: false, code: "invalid_input" };
      this.put("speech:openrouter", preferences);
      return { ok: true, value: { preferences, source: "explicit" } };
    });
  }
}
