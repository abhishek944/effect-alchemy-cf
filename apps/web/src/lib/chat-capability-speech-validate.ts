/**
 * Manual validators for the speech settings projection. An incompatible
 * model/voice pair is rejected rather than substituted, and only the exact
 * native voice set is accepted for the selected speech model.
 */
import type {
  ChatSpeechModel,
  ChatSpeechPreferences,
  ChatSpeechPreferencesView,
  ChatSpeechVoice,
  ChatTranscriptionModel,
} from "@/lib/chat-capability-speech-types";
import {
  isCompatibleSpeechVoice,
  SPEECH_MODELS,
  SPEECH_VOICES,
  TRANSCRIPTION_MODELS,
} from "@/lib/chat-capability-speech-types";
import { isSafeCount } from "@/lib/chat-capability-validate";
import type { PreferenceSource } from "@/lib/chat-capability-types";
import { isRecord } from "@/lib/chat-validate-base";

export {
  isCompatibleSpeechVoice,
  nativeVoicesForSpeechModel,
} from "@/lib/chat-capability-speech-types";

const listed = <T extends string>(values: readonly T[], value: unknown): value is T =>
  values.find((candidate) => candidate === value) !== undefined;

export const isChatTranscriptionModel = (value: unknown): value is ChatTranscriptionModel =>
  listed(TRANSCRIPTION_MODELS, value);

export const isChatSpeechModel = (value: unknown): value is ChatSpeechModel =>
  listed(SPEECH_MODELS, value);

export const isChatSpeechVoice = (value: unknown): value is ChatSpeechVoice =>
  listed(SPEECH_VOICES, value);

const isSource = (value: unknown): value is PreferenceSource =>
  value === "explicit" || value === "default";

export function parseChatSpeechPreferences(value: unknown): ChatSpeechPreferences | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (!isSafeCount(value.revision)) return null;
  if (!isChatTranscriptionModel(value.transcriptionModel)) return null;
  if (!isChatSpeechModel(value.speechModel)) return null;
  if (!isChatSpeechVoice(value.voice)) return null;
  if (!isCompatibleSpeechVoice(value.speechModel, value.voice)) return null;
  return {
    version: 1,
    revision: value.revision,
    transcriptionModel: value.transcriptionModel,
    speechModel: value.speechModel,
    voice: value.voice,
  };
}

export function parseChatSpeechPreferencesView(value: unknown): ChatSpeechPreferencesView | null {
  if (!isRecord(value) || !isSource(value.source)) return null;
  const preferences = parseChatSpeechPreferences(value.preferences);
  return preferences === null ? null : { preferences, source: value.source };
}
