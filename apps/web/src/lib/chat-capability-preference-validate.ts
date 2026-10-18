/** Validators distinguish saved chat-model choices from initial defaults. */
import type {
  AccountChatPreferences,
  AccountChatPreferencesView,
  AccountChatPreferencesWriteResult,
  ChatModelEffort,
  ChatPreferences,
  ChatPreferencesView,
  ChatPreferencesWriteResult,
  PreferenceSource,
} from "@/lib/chat-capability-types";
import { MODEL_EFFORT_LIMIT } from "@/lib/chat-capability-types";
import {
  isChatEffort,
  isChatModelId,
  isSafeCount,
  parseChatSelection,
} from "@/lib/chat-capability-validate";
import { isRecord, isUuid } from "@/lib/chat-validate-base";

const isSource = (value: unknown): value is PreferenceSource =>
  value === "explicit" || value === "default";

function parseModelEfforts(value: unknown): ChatModelEffort[] | null {
  if (!Array.isArray(value) || value.length > MODEL_EFFORT_LIMIT) return null;
  const efforts: ChatModelEffort[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isChatModelId(item.model) || !isChatEffort(item.effort)) return null;
    if (efforts.some((other) => other.model === item.model)) return null;
    efforts.push({ model: item.model, effort: item.effort });
  }
  return efforts;
}

export function parseAccountChatPreferences(value: unknown): AccountChatPreferences | null {
  if (!isRecord(value) || value.version !== 1 || !isSafeCount(value.revision)) return null;
  const defaultSelection = parseChatSelection(value.defaultSelection);
  if (!defaultSelection) return null;
  return { version: 1, revision: value.revision, defaultSelection };
}

export function parseAccountChatPreferencesView(value: unknown): AccountChatPreferencesView | null {
  if (!isRecord(value) || !isSource(value.source)) return null;
  const preferences = parseAccountChatPreferences(value.preferences);
  return preferences === null ? null : { preferences, source: value.source };
}

export function parseChatPreferences(value: unknown): ChatPreferences | null {
  if (!isRecord(value) || value.version !== 1 || !isSafeCount(value.revision)) return null;
  const preferred = parseChatSelection(value.preferred);
  const modelEfforts = parseModelEfforts(value.modelEfforts);
  if (!preferred || !modelEfforts) return null;
  return { version: 1, revision: value.revision, preferred, modelEfforts };
}

export function parseChatPreferencesView(value: unknown): ChatPreferencesView | null {
  if (!isRecord(value) || !isUuid(value.chatId)) return null;
  if (!isSource(value.source)) return null;
  const preferences = parseChatPreferences(value.preferences);
  return preferences === null ? null : { chatId: value.chatId, preferences, source: value.source };
}

export function parseChatPreferencesWriteResult(value: unknown): ChatPreferencesWriteResult | null {
  if (!isRecord(value) || typeof value.accountDefaultUpdated !== "boolean") return null;
  const view = parseChatPreferencesView(value.view);
  return view === null ? null : { view, accountDefaultUpdated: value.accountDefaultUpdated };
}

export function parseAccountChatPreferencesWriteResult(
  value: unknown,
): AccountChatPreferencesWriteResult | null {
  if (!isRecord(value)) return null;
  const view = parseAccountChatPreferencesView(value.view);
  return view === null ? null : { view };
}
