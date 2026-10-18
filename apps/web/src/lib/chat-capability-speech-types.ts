/**
 * Browser projection of speech settings and limits.
 *
 * Speech stays separate from chat model, effort and token accounting. Model
 * and voice values mirror the supported OpenRouter audio catalog. Invalid
 * model/voice pairs fail closed rather than being substituted. No API key,
 * profile or upstream URL belongs in browser state.
 */
import type { PreferenceSource } from "@/lib/chat-capability-types";

export const TRANSCRIPTION_MODELS = [
  "openai/gpt-4o-mini-transcribe",
  "openai/gpt-4o-transcribe",
] as const;
export type ChatTranscriptionModel = (typeof TRANSCRIPTION_MODELS)[number];

export const SPEECH_MODELS = [
  "mistralai/voxtral-mini-tts-2603",
  "x-ai/grok-voice-tts-1.0",
] as const;
export type ChatSpeechModel = (typeof SPEECH_MODELS)[number];

const MISTRAL_VOICES = ["en_paul_neutral"] as const;
const GROK_VOICES = ["eve", "ara", "rex", "sal", "leo"] as const;
export const SPEECH_VOICES = [...MISTRAL_VOICES, ...GROK_VOICES] as const;
export type ChatSpeechVoice = (typeof SPEECH_VOICES)[number];

/** Supported built-in voices, matched to the selected OpenRouter model. */
export const nativeVoicesForSpeechModel = (model: ChatSpeechModel): readonly ChatSpeechVoice[] =>
  model === "mistralai/voxtral-mini-tts-2603" ? MISTRAL_VOICES : GROK_VOICES;

export const isCompatibleSpeechVoice = (model: ChatSpeechModel, voice: ChatSpeechVoice): boolean =>
  nativeVoicesForSpeechModel(model).find((candidate) => candidate === voice) !== undefined;

export const DEFAULT_SPEECH_PREFERENCES = {
  transcriptionModel: "openai/gpt-4o-mini-transcribe",
  speechModel: "mistralai/voxtral-mini-tts-2603",
  voice: "en_paul_neutral",
} as const;

export type ChatSpeechPreferences = {
  version: 1;
  revision: number;
  transcriptionModel: ChatTranscriptionModel;
  speechModel: ChatSpeechModel;
  voice: ChatSpeechVoice;
};

export type ChatSpeechPreferencesView = {
  preferences: ChatSpeechPreferences;
  source: PreferenceSource;
};

export type ChatSpeechPreferencesWrite = {
  expectedRevision: number;
  transcriptionModel: ChatTranscriptionModel;
  speechModel: ChatSpeechModel;
  voice: ChatSpeechVoice;
};

export const MAX_RECORDING_MS = 120_000;
export const MAX_RECORDING_BYTES = 10_485_760;

export const AUDIO_MEDIA_TYPES = [
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
] as const;
export type ChatAudioMediaType = (typeof AUDIO_MEDIA_TYPES)[number];

export const MAX_SPEECH_INPUT_CHARS = 4_096;
/** Conservative application budget retained across providers, not a provider limit. */
export const SPEECH_INPUT_TOKEN_LIMIT = 2_000;
export const SPEECH_CHUNK_TARGET_CHARS = 1_024;
export const SPEECH_CHUNK_TARGET_TOKENS = 1_000;

/** Caller-supplied estimate: characters are exact, tokens must be estimated. */
export type ChatSpeechTextEstimate = {
  readonly characters: number;
  readonly estimatedTokens: number;
};

/** The one safe predicate for a single synthesis request; used by T22 chunking. */
export const speechSynthesisWithinLimit = (estimate: ChatSpeechTextEstimate): boolean =>
  Number.isSafeInteger(estimate.characters) &&
  estimate.characters > 0 &&
  estimate.characters <= MAX_SPEECH_INPUT_CHARS &&
  Number.isSafeInteger(estimate.estimatedTokens) &&
  estimate.estimatedTokens > 0 &&
  estimate.estimatedTokens <= SPEECH_INPUT_TOKEN_LIMIT;

/** Two-minute or 10 MiB recording cap, whichever occurs first. */
export const recordingWithinLimit = (durationMs: number, byteSize: number): boolean =>
  Number.isSafeInteger(durationMs) &&
  durationMs > 0 &&
  durationMs <= MAX_RECORDING_MS &&
  Number.isSafeInteger(byteSize) &&
  byteSize > 0 &&
  byteSize <= MAX_RECORDING_BYTES;
