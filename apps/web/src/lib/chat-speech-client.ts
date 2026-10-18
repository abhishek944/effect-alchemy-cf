/**
 * Same-origin speech client.
 *
 * The browser sends only its own audio, the operation identity and the text it
 * wants spoken: models, voices, credentials and upstream URLs are chosen by the
 * server from saved preferences. Preferences use the fixed catalog route; the
 * two operation routes are multipart transcription and binary synthesis. GET
 * and PATCH both return the bare `SpeechPreferencesView` shape.
 */
import { ChatApiError, errorMessage } from "@/lib/chat-api";
import { parseChatSpeechPreferencesView } from "@/lib/chat-capability-speech-validate";
import type {
  ChatSpeechPreferencesView,
  ChatSpeechPreferencesWrite,
} from "@/lib/chat-capability-speech-types";
import { encodeCanonicalWav } from "@/lib/chat-speech-wav";
import { isRecord } from "@/lib/chat-validate-base";

export const SPEECH_PREFERENCES_PATH = "/api/chat/speech/preferences";
export const SPEECH_TRANSCRIBE_PATH = "/api/chat/speech/transcribe";
export const SPEECH_SPEAK_PATH = "/api/chat/speech/speak";

const statusMessages: Record<number, string> = {
  400: "That speech request was not valid.",
  401: "You are signed out. Sign in again to use voice.",
  403: "This request was blocked. Reload the page and try again.",
  413: "That recording is too large to transcribe.",
  502: "The speech provider could not complete that request.",
  503: "Speech is temporarily unavailable.",
  504: "The speech provider took too long. Try again.",
};

const failureMessage = async (response: Response): Promise<string> => {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.message === "string" && body.message.trim())
      return body.message;
  } catch {
    // Keep the safe status message when the body is not JSON.
  }
  return statusMessages[response.status] ?? `Speech request failed (${response.status}).`;
};

export const speechRequestError = (error: unknown): string =>
  error instanceof ChatApiError ? error.message : errorMessage(error);

export const fetchSpeechPreferences = async (
  signal?: AbortSignal,
): Promise<ChatSpeechPreferencesView> => {
  const response = await fetch(SPEECH_PREFERENCES_PATH, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal: signal ?? null,
  });
  if (!response.ok) throw new ChatApiError(response.status, await failureMessage(response));
  const parsed = parseChatSpeechPreferencesView(await response.json());
  if (parsed === null)
    throw new ChatApiError(502, "The server returned unexpected speech preferences.");
  return parsed;
};

export const saveSpeechPreferences = async (
  input: ChatSpeechPreferencesWrite,
): Promise<ChatSpeechPreferencesView> => {
  const response = await fetch(SPEECH_PREFERENCES_PATH, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new ChatApiError(response.status, await failureMessage(response));
  const parsed = parseChatSpeechPreferencesView(await response.json());
  if (parsed === null)
    throw new ChatApiError(502, "The server returned unexpected speech preferences.");
  return parsed;
};

export type SpeechTranscribeInput = {
  readonly operationId: string;
  readonly chatId: string | null;
  readonly audio: Blob;
  readonly signal?: AbortSignal;
};

export type SpeechTranscribeCall = (
  input: SpeechTranscribeInput,
) => Promise<{ readonly text: string }>;

export const transcribeRecording = async (
  input: SpeechTranscribeInput,
): Promise<{ readonly text: string }> => {
  const wav = await encodeCanonicalWav(input.audio, input.signal);
  if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const form = new FormData();
  form.set("operationId", input.operationId);
  if (input.chatId !== null) form.set("chatId", input.chatId);
  form.set("file", wav, "recording.wav");
  const response = await fetch(SPEECH_TRANSCRIBE_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    body: form,
    signal: input.signal ?? null,
  });
  if (!response.ok) throw new ChatApiError(response.status, await failureMessage(response));
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.text !== "string")
    throw new ChatApiError(502, "The transcription response was not readable.");
  return { text: body.text };
};

export type SpeechAudioInput = {
  readonly operationId: string;
  readonly chatId: string | null;
  /** One stable id for the whole read-aloud action; frozen prefs follow it. */
  readonly playbackId: string;
  readonly text: string;
  readonly signal?: AbortSignal;
};

export type SpeechAudioCall = (
  input: SpeechAudioInput,
) => Promise<{ readonly blob: Blob; readonly contentType: string }>;

export const requestSpeechAudio = async (
  input: SpeechAudioInput,
): Promise<{ readonly blob: Blob; readonly contentType: string }> => {
  const response = await fetch(SPEECH_SPEAK_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "audio/mpeg", "content-type": "application/json" },
    body: JSON.stringify({
      operationId: input.operationId,
      chatId: input.chatId,
      playbackId: input.playbackId,
      text: input.text,
    }),
    signal: input.signal ?? null,
  });
  if (!response.ok) throw new ChatApiError(response.status, await failureMessage(response));
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("audio/"))
    throw new ChatApiError(502, "The read-aloud response was not audio.");
  return { blob: await response.blob(), contentType: contentType.split(";")[0] ?? "audio/mpeg" };
};
