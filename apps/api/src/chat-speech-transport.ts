/**
 * Fixed OpenRouter speech transport against the validated server runtime. One
 * attempt per operation: bounded multipart transcription and bounded binary
 * synthesis, no retry, no redirects.
 */
import { Option, Schema } from "effect";
import { withCause } from "@starter/diagnostics";
import { beginSpeechAttempt, drainResponse, readBoundedBytes } from "./chat-speech-io.ts";
import type { SpeechModel, SpeechVoice, TranscriptionModel } from "./chat-speech-schema.ts";
import {
  speechProviderHeaders,
  SYNTHESIS_ENDPOINT,
  TRANSCRIPTION_ENDPOINT,
  type SpeechRuntime,
} from "./chat-speech-runtime.ts";

export const TRANSCRIPTION_RESPONSE_LIMIT = 256 * 1024;
export const SPEECH_AUDIO_LIMIT = 8 * 1024 * 1024;
export type SpeechTransportFailure =
  | "timeout"
  | "network"
  | "cancelled"
  | "upstream_rejected"
  | "invalid_response";

export class SpeechTransportError extends Error {
  readonly code: SpeechTransportFailure;
  readonly status: number | null;
  /** Provider-reported units when the response reported them before failing. */
  readonly reported: TranscriptionReportedUsage | null;

  constructor(
    code: SpeechTransportFailure,
    status: number | null,
    reported: TranscriptionReportedUsage | null = null,
  ) {
    super("Speech transport failed");
    this.name = "SpeechTransportError";
    this.code = code;
    this.status = status;
    this.reported = reported;
  }
}

const attempt = async <T>(
  signal: AbortSignal | undefined,
  run: (owned: AbortSignal) => Promise<T>,
): Promise<T> => {
  const owned = beginSpeechAttempt(signal);
  try {
    return await run(owned.signal);
  } catch (error) {
    if (error instanceof SpeechTransportError) throw error;
    if (owned.timedOut()) throw withCause(new SpeechTransportError("timeout", null), error);
    if (owned.cancelled()) throw withCause(new SpeechTransportError("cancelled", null), error);
    throw withCause(new SpeechTransportError("network", null), error);
  } finally {
    owned.clear();
  }
};

/** Preserve the intended upstream rejection even when draining its body fails. */
const rejectUpstream = async (response: Response): Promise<never> => {
  const failure = new SpeechTransportError("upstream_rejected", response.status);
  try {
    await drainResponse(response);
  } catch (error) {
    withCause(failure, error);
  }
  throw failure;
};

const decodeOption = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S["Type"] | null => Option.getOrNull(Schema.decodeUnknownOption(schema)(input));

export type TranscriptionInput = {
  readonly model: TranscriptionModel;
  /** Canonical 16 kHz mono PCM16 WAV, encoded by the browser before upload. */
  readonly audio: Uint8Array;
};

/** A real usage unit reported by OpenRouter for one transcription request. */
export type TranscriptionReportedUsage =
  | { readonly unit: "audio_seconds"; readonly quantity: number }
  | { readonly unit: "tokens"; readonly quantity: number };

export type TranscriptionResult = {
  readonly text: string;
  readonly reported: TranscriptionReportedUsage | null;
};

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** Preserves seconds or tokens exactly as reported; never relabels the unit. */
const usageOf = (body: unknown): TranscriptionReportedUsage | null => {
  if (typeof body !== "object" || body === null) return null;
  const usage: unknown = Reflect.get(body, "usage");
  if (typeof usage !== "object" || usage === null) return null;
  const seconds = finite(Reflect.get(usage, "seconds"));
  if (seconds !== null) return { unit: "audio_seconds", quantity: seconds };
  const total = finite(Reflect.get(usage, "total_tokens"));
  if (total !== null) return { unit: "tokens", quantity: total };
  const input = finite(Reflect.get(usage, "input_tokens"));
  const output = finite(Reflect.get(usage, "output_tokens"));
  return input !== null && output !== null ? { unit: "tokens", quantity: input + output } : null;
};

/** Performs the one native multipart transcription request. */
export const transcribeAudio = (
  runtime: SpeechRuntime,
  input: TranscriptionInput,
  signal: AbortSignal | undefined,
): Promise<TranscriptionResult> =>
  attempt(signal, async (owned) => {
    const form = new FormData();
    form.set("file", new File([input.audio], "recording.wav", { type: "audio/wav" }));
    form.set("model", input.model);
    form.set("response_format", "json");
    const response = await fetch(TRANSCRIPTION_ENDPOINT, {
      method: "POST",
      headers: speechProviderHeaders(runtime, false),
      body: form,
      redirect: "error",
      cache: "no-store",
      signal: owned,
    });
    if (!response.ok) return rejectUpstream(response);
    const contentType = (response.headers.get("content-type") ?? "")
      .toLowerCase()
      .split(";")[0]
      ?.trim();
    if (contentType !== "application/json") {
      await drainResponse(response);
      throw new SpeechTransportError("invalid_response", null);
    }
    const raw = await readBoundedBytes(response, TRANSCRIPTION_RESPONSE_LIMIT);
    if (raw === null) throw new SpeechTransportError("invalid_response", null);
    const rawText = new TextDecoder().decode(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      throw withCause(new SpeechTransportError("invalid_response", null), error);
    }
    const reported = usageOf(parsed);
    const decoded = decodeOption(Schema.Struct({ text: Schema.String }), parsed);
    if (decoded === null) throw new SpeechTransportError("invalid_response", null, reported);
    return { text: decoded.text, reported };
  });

export type SynthesisInput = {
  readonly model: SpeechModel;
  readonly voice: SpeechVoice;
  readonly text: string;
};

export type SynthesisResult = {
  readonly contentType: string;
  /** Fully read inside the attempt lifetime; bounded by SPEECH_AUDIO_LIMIT. */
  readonly audio: Uint8Array;
};

/** Performs the one native JSON synthesis request and reads bounded MP3 inside it. */
export const synthesizeSpeech = (
  runtime: SpeechRuntime,
  input: SynthesisInput,
  signal: AbortSignal | undefined,
): Promise<SynthesisResult> =>
  attempt(signal, async (owned) => {
    const headers = speechProviderHeaders(runtime, true);
    headers.set("accept", "audio/mpeg");
    const response = await fetch(SYNTHESIS_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: input.model,
        input: input.text,
        voice: input.voice,
        response_format: "mp3",
      }),
      redirect: "error",
      cache: "no-store",
      signal: owned,
    });
    if (!response.ok) return rejectUpstream(response);
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.split(";")[0]?.trim() !== "audio/mpeg") {
      await drainResponse(response);
      throw new SpeechTransportError("invalid_response", null);
    }
    const audio = await readBoundedBytes(response, SPEECH_AUDIO_LIMIT);
    if (audio === null || audio.byteLength === 0)
      throw new SpeechTransportError("invalid_response", null);
    return { contentType: contentType.split(";")[0] ?? "audio/mpeg", audio };
  });
