/**
 * Speech settings and the native transcription/synthesis operation boundary.
 *
 * Speech stays separate from chat model, effort and token accounting. Model,
 * voice values match the supported OpenRouter audio catalog. Compatibility is
 * enforced here so an invalid stored voice fails closed rather than being
 * substituted. Server-only API keys and upstream URLs never appear in a schema.
 */
import { Option, Schema } from "effect";
import { PreferenceSource, readField } from "./chat-capabilities.ts";

export const TRANSCRIPTION_MODELS = [
  "openai/gpt-4o-mini-transcribe",
  "openai/gpt-4o-transcribe",
] as const;
export const TranscriptionModel = Schema.Literals(TRANSCRIPTION_MODELS);
export type TranscriptionModel = typeof TranscriptionModel.Type;

export const SPEECH_MODELS = [
  "mistralai/voxtral-mini-tts-2603",
  "x-ai/grok-voice-tts-1.0",
] as const;
export const SpeechModel = Schema.Literals(SPEECH_MODELS);
export type SpeechModel = typeof SpeechModel.Type;

const MISTRAL_VOICES = ["en_paul_neutral"] as const;
const GROK_VOICES = ["eve", "ara", "rex", "sal", "leo"] as const;
export const SPEECH_VOICES = [...MISTRAL_VOICES, ...GROK_VOICES] as const;
export const SpeechVoice = Schema.Literals(SPEECH_VOICES);
export type SpeechVoice = typeof SpeechVoice.Type;

/** Supported built-in voices; do not send one provider's voice to another. */
export const nativeVoicesFor = (model: SpeechModel): readonly SpeechVoice[] =>
  model === "mistralai/voxtral-mini-tts-2603" ? MISTRAL_VOICES : GROK_VOICES;
export const isCompatibleVoice = (model: SpeechModel, voice: SpeechVoice): boolean =>
  nativeVoicesFor(model).includes(voice);

export const DEFAULT_SPEECH_PREFERENCES = {
  transcriptionModel: "openai/gpt-4o-mini-transcribe",
  speechModel: "mistralai/voxtral-mini-tts-2603",
  voice: "en_paul_neutral",
} as const;

export const SpeechRevision = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
);
export type SpeechRevision = typeof SpeechRevision.Type;

const compatible = (settings: { speechModel: SpeechModel; voice: SpeechVoice }): boolean =>
  isCompatibleVoice(settings.speechModel, settings.voice);

export const SpeechPreferences = Schema.Struct({
  version: Schema.Literal(1),
  revision: SpeechRevision,
  transcriptionModel: TranscriptionModel,
  speechModel: SpeechModel,
  voice: SpeechVoice,
}).check(Schema.makeFilter(compatible));
export type SpeechPreferences = typeof SpeechPreferences.Type;

export const SpeechPreferencesView = Schema.Struct({
  preferences: SpeechPreferences,
  source: PreferenceSource,
});
export type SpeechPreferencesView = typeof SpeechPreferencesView.Type;

export const SpeechPreferencesWrite = Schema.Struct({
  expectedRevision: SpeechRevision,
  transcriptionModel: TranscriptionModel,
  speechModel: SpeechModel,
  voice: SpeechVoice,
}).check(Schema.makeFilter(compatible));
export type SpeechPreferencesWrite = typeof SpeechPreferencesWrite.Type;

export const SPEECH_FAILURES = ["invalid_input", "incompatible_voice"] as const;
export const SpeechFailure = Schema.Literals(SPEECH_FAILURES);
export type SpeechFailure = typeof SpeechFailure.Type;

export type SpeechSettingsResolution =
  | { readonly ok: true; readonly preferences: SpeechPreferences }
  | { readonly ok: false; readonly code: SpeechFailure };

/** Decodes candidate speech settings and rejects an incompatible voice. */
export const resolveSpeechPreferences = (input: unknown): SpeechSettingsResolution => {
  const decoded = decodeSpeechPreferences(input);
  if (decoded !== null) return { ok: true, preferences: decoded };
  const speechModel = speechModelOf(input);
  const voice = voiceOf(input);
  if (speechModel !== null && voice !== null && !isCompatibleVoice(speechModel, voice))
    return { ok: false, code: "incompatible_voice" };
  return { ok: false, code: "invalid_input" };
};

export const decodeSpeechPreferences = (input: unknown): SpeechPreferences | null =>
  Option.getOrNull(Schema.decodeUnknownOption(SpeechPreferences)(input));

const speechModelOf = (input: unknown): SpeechModel | null => {
  const value = readField(input, "speechModel");
  return SPEECH_MODELS.find((model) => model === value) ?? null;
};

const voiceOf = (input: unknown): SpeechVoice | null => {
  const value = readField(input, "voice");
  return SPEECH_VOICES.find((voice) => voice === value) ?? null;
};

export const MAX_RECORDING_MS = 120_000;
export const MAX_RECORDING_BYTES = 10_485_760;
export const MAX_SPEECH_INPUT_CHARS = 4_096;
/** Conservative application budget retained across providers, not a provider limit. */
export const SPEECH_INPUT_TOKEN_LIMIT = 2_000;
/** Conservative per-request segment targets below both hard model limits. */
export const SPEECH_CHUNK_TARGET_CHARS = 1_024;
export const SPEECH_CHUNK_TARGET_TOKENS = 1_000;

/** Caller-supplied estimate: characters are exact, tokens must be estimated, never assumed. */
export type SpeechTextEstimate = {
  readonly characters: number;
  readonly estimatedTokens: number;
};

/** The one safe predicate for a single synthesis request; used by T22 chunking. */
export const speechSynthesisWithinLimit = (estimate: SpeechTextEstimate): boolean =>
  Number.isSafeInteger(estimate.characters) &&
  estimate.characters > 0 &&
  estimate.characters <= MAX_SPEECH_INPUT_CHARS &&
  Number.isSafeInteger(estimate.estimatedTokens) &&
  estimate.estimatedTokens > 0 &&
  estimate.estimatedTokens <= SPEECH_INPUT_TOKEN_LIMIT;

export const AUDIO_MEDIA_TYPES = [
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
] as const;
export const AudioMediaType = Schema.Literals(AUDIO_MEDIA_TYPES);
export type AudioMediaType = typeof AudioMediaType.Type;
