/**
 * Bounded public speech request bodies.
 *
 * The browser supplies its audio and the operation identity; it never supplies
 * a model, voice, duration claim or upstream destination. Actual byte counts
 * are enforced from the streamed body, and transcription accepts only the
 * canonical 16 kHz mono PCM16 WAV whose duration is derived from its bytes.
 */
import { Option, Schema } from "effect";
import { measureSpeechAudio } from "./chat-audio-duration.ts";
import { readBoundedBody } from "./body-limit.ts";
import { DomainUuid } from "./chat-capabilities.ts";
import {
  AUDIO_MEDIA_TYPES,
  MAX_RECORDING_BYTES,
  MAX_SPEECH_INPUT_CHARS,
} from "./chat-speech-schema.ts";

const MULTIPART_OVERHEAD = 64 * 1024;
const TRANSCRIBE_BODY_LIMIT = MAX_RECORDING_BYTES + MULTIPART_OVERHEAD;
const SPEAK_BODY_LIMIT = 32 * 1024;

export type SpeechWireFailure = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
};
export type SpeechWireResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: SpeechWireFailure };

const fail = (status: number, code: string, message: string): SpeechWireResult<never> => ({
  ok: false,
  failure: { status, code, message },
});

const decodeOption = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S["Type"] | null => Option.getOrNull(Schema.decodeUnknownOption(schema)(input));

export const SpeechSpeakRequest = Schema.Struct({
  operationId: DomainUuid,
  chatId: Schema.optionalKey(Schema.NullOr(DomainUuid)),
  /** Stable for every chunk of one manual read-aloud action. */
  playbackId: DomainUuid,
  text: Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_SPEECH_INPUT_CHARS),
  ),
});
export type SpeechSpeakRequest = typeof SpeechSpeakRequest.Type;

export type TranscriptionRequest = {
  readonly operationId: string;
  readonly chatId: string | null;
  /** Derived from the canonical WAV bytes, never from a client claim. */
  readonly measuredDurationMs: number;
  readonly audio: Uint8Array;
};

const formOf = async (request: Request, body: Uint8Array): Promise<FormData | null> => {
  const contentType = request.headers.get("content-type") ?? "";
  const lower = contentType.toLowerCase();
  if (!lower.startsWith("multipart/form-data") || !lower.includes("boundary=")) return null;
  try {
    return await new Request("https://speech.internal/upload", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    }).formData();
  } catch {
    return null;
  }
};

const chatIdOf = (form: FormData): { readonly ok: boolean; readonly value: string | null } => {
  const raw = form.get("chatId");
  if (raw === null || raw === "") return { ok: true, value: null };
  const decoded = decodeOption(DomainUuid, raw);
  return decoded === null ? { ok: false, value: null } : { ok: true, value: decoded };
};

/** Parses and bounds a multipart transcription upload. */
export const readTranscriptionRequest = async (
  request: Request,
): Promise<SpeechWireResult<TranscriptionRequest>> => {
  const body = await readBoundedBody(request, TRANSCRIBE_BODY_LIMIT);
  if (body === null) return fail(413, "payload_too_large", "Recordings are limited to 10 MiB.");
  const form = await formOf(request, body);
  if (form === null)
    return fail(400, "invalid_request", "Send the recording as multipart form data.");
  const file = form.get("file");
  if (!(file instanceof File) || file.size <= 0)
    return fail(400, "invalid_request", "Attach one recorded audio file.");
  if (file.size > MAX_RECORDING_BYTES)
    return fail(413, "payload_too_large", "Recordings are limited to 10 MiB.");
  const operationId = decodeOption(DomainUuid, form.get("operationId"));
  if (operationId === null) return fail(400, "invalid_request", "Missing operation identity.");
  const chatId = chatIdOf(form);
  if (!chatId.ok) return fail(400, "invalid_request", "Invalid chat identity on the recording.");
  const audio = new Uint8Array(await file.arrayBuffer());
  if (audio.byteLength !== file.size)
    return fail(400, "invalid_request", "The recording could not be read completely.");
  const mediaType = AUDIO_MEDIA_TYPES.find(
    (candidate) => candidate === (file.type.split(";")[0]?.trim().toLowerCase() ?? ""),
  );
  const measured = mediaType === undefined ? null : measureSpeechAudio(mediaType, audio);
  if (measured === null || !measured.ok) {
    if (measured?.reason === "too_long")
      return fail(400, "invalid_request", "Recordings are limited to two minutes.");
    if (measured?.reason === "unsupported_audio")
      return fail(400, "unsupported_audio", "Send the recording as a canonical WAV file.");
    return fail(
      400,
      "unsupported_audio",
      "Send the recording as a canonical 16 kHz mono WAV file.",
    );
  }
  return {
    ok: true,
    value: { operationId, chatId: chatId.value, measuredDurationMs: measured.durationMs, audio },
  };
};

/** Parses the bounded JSON synthesis request. */
export const readSpeakRequest = async (
  request: Request,
): Promise<SpeechWireResult<SpeechSpeakRequest>> => {
  const body = await readBoundedBody(request, SPEAK_BODY_LIMIT);
  if (body === null) return fail(413, "payload_too_large", "This request is too large.");
  const raw: unknown = ((): unknown => {
    try {
      return JSON.parse(new TextDecoder().decode(body));
    } catch {
      return null;
    }
  })();
  const decoded = decodeOption(SpeechSpeakRequest, raw);
  if (decoded === null) return fail(400, "invalid_request", "Send the text to read aloud as JSON.");
  return { ok: true, value: decoded };
};
