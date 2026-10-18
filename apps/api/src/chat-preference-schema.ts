/** Versioned preferences. Explicit choices update new-chat defaults, never an active response. */
import { Schema } from "effect";
import {
  ChatEffort,
  ChatModelId,
  ChatSelection,
  DEFAULT_CHAT_SELECTION,
  DomainUuid,
  PreferenceSource,
} from "./chat-capabilities.ts";

export const CHAT_PREFERENCES_VERSION = 1;
export const MAX_MODEL_EFFORTS = 64;

export const PreferenceRevision = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
);
export type PreferenceRevision = typeof PreferenceRevision.Type;

export const AccountChatPreferences = Schema.Struct({
  version: Schema.Literal(1),
  revision: PreferenceRevision,
  defaultSelection: ChatSelection,
});
export type AccountChatPreferences = typeof AccountChatPreferences.Type;

export const AccountChatPreferencesView = Schema.Struct({
  preferences: AccountChatPreferences,
  source: PreferenceSource,
});
export type AccountChatPreferencesView = typeof AccountChatPreferencesView.Type;

export const ChatModelEffort = Schema.Struct({ model: ChatModelId, effort: ChatEffort });
export type ChatModelEffort = typeof ChatModelEffort.Type;

export const ChatPreferences = Schema.Struct({
  version: Schema.Literal(1),
  revision: PreferenceRevision,
  preferred: ChatSelection,
  modelEfforts: Schema.Array(ChatModelEffort).check(
    Schema.isMaxLength(MAX_MODEL_EFFORTS),
    Schema.makeFilter(
      (entries) => new Set(entries.map((entry) => entry.model)).size === entries.length,
    ),
  ),
});
export type ChatPreferences = typeof ChatPreferences.Type;

export const ChatPreferencesView = Schema.Struct({
  chatId: DomainUuid,
  preferences: ChatPreferences,
  source: PreferenceSource,
});
export type ChatPreferencesView = typeof ChatPreferencesView.Type;

export const AccountChatPreferencesWrite = Schema.Struct({
  expectedRevision: PreferenceRevision,
  selection: ChatSelection,
});
export type AccountChatPreferencesWrite = typeof AccountChatPreferencesWrite.Type;

export const ChatPreferencesWrite = Schema.Struct({
  chatId: DomainUuid,
  expectedRevision: PreferenceRevision,
  selection: ChatSelection,
});
export type ChatPreferencesWrite = typeof ChatPreferencesWrite.Type;

export const ChatPreferencesWriteResult = Schema.Struct({
  view: ChatPreferencesView,
  /** True only for an explicit model or effort change inside this chat. */
  accountDefaultUpdated: Schema.Boolean,
});
export type ChatPreferencesWriteResult = typeof ChatPreferencesWriteResult.Type;

export const AccountChatPreferencesWriteResult = Schema.Struct({
  view: AccountChatPreferencesView,
});
export type AccountChatPreferencesWriteResult = typeof AccountChatPreferencesWriteResult.Type;

export const PREFERENCE_FAILURES = ["invalid_input", "revision_conflict"] as const;
export const PreferenceFailure = Schema.Literals(PREFERENCE_FAILURES);
export type PreferenceFailure = typeof PreferenceFailure.Type;

export type PreferenceWriteResolution<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: PreferenceFailure };

/** Initial application preferences before any saved choice. */
export const initialChatPreferences = (): ChatPreferences => ({
  version: 1,
  revision: 0,
  preferred: DEFAULT_CHAT_SELECTION,
  modelEfforts: [],
});

export const initialAccountChatPreferences = (): AccountChatPreferences => ({
  version: 1,
  revision: 0,
  defaultSelection: DEFAULT_CHAT_SELECTION,
});

/** Remembered effort for one model, or null when that model was never chosen. */
export const rememberedEffort = (
  efforts: readonly ChatModelEffort[],
  model: ChatModelId,
): ChatEffort | null => efforts.find((entry) => entry.model === model)?.effort ?? null;

/** Most-recent-first bounded memory; only an explicit choice calls this. */
export const withModelEffort = (
  efforts: readonly ChatModelEffort[],
  selection: ChatSelection,
): readonly ChatModelEffort[] =>
  [
    { model: selection.model, effort: selection.effort },
    ...efforts.filter((entry) => entry.model !== selection.model),
  ].slice(0, MAX_MODEL_EFFORTS);
