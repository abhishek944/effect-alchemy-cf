/**
 * Trusted pre-paid speech duration boundary (correctness C9, narrowed design).
 *
 * The browser locally decodes the captured MediaRecorder blob and re-encodes it
 * to one canonical uncompressed WAV before upload: mono, 16-bit PCM, 16 kHz,
 * exactly the 44-byte RIFF/WAVE header with no extraneous chunks. This module
 * accepts only that exact byte shape and derives the duration from the actual
 * sample count. Compressed or noncanonical data is rejected before any paid
 * provider call, and the caller-supplied multipart `durationMs` is never read.
 */
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_MS,
  type AudioMediaType,
} from "./chat-speech-schema.ts";

export type AudioDurationFailure = "invalid_audio" | "unsupported_audio" | "too_long";

export type AudioDurationResult =
  | { readonly ok: true; readonly durationMs: number }
  | { readonly ok: false; readonly reason: AudioDurationFailure };

/** Canonical WAV contract, exactly one accepted variant. */
const HEADER_BYTES = 44;
const FMT_CHUNK_BYTES = 16;
const PCM_FORMAT = 1;
const MONO_CHANNELS = 1;
const SAMPLE_RATE = 16_000;
const BYTE_RATE = 32_000;
const BLOCK_ALIGN = 2;
const BITS_PER_SAMPLE = 16;
const SAMPLES_PER_MILLISECOND = 16;
/** 120 s at 16 kHz; the byte ceiling is looser than this for canonical PCM. */
const MAX_SAMPLES = (MAX_RECORDING_MS / 1_000) * SAMPLE_RATE;

const invalid = (): AudioDurationResult => ({ ok: false, reason: "invalid_audio" });
const unsupported = (): AudioDurationResult => ({ ok: false, reason: "unsupported_audio" });
const tooLong = (): AudioDurationResult => ({ ok: false, reason: "too_long" });

const ascii = (bytes: Uint8Array, offset: number, text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
};

const u16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);

const u32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
  0;

/**
 * Measures only the canonical browser re-encode: `audio/wav`, 44-byte header,
 * `fmt ` size 16, PCM1, mono, 16000 Hz, byteRate 32000, blockAlign 2, 16 bits,
 * `data` immediately after the header, exact RIFF and data sizes, nonempty
 * even data. Any other media type or WAV variant fails closed.
 */
export const measureSpeechAudio = (
  mediaType: AudioMediaType,
  bytes: Uint8Array,
): AudioDurationResult => {
  if (mediaType !== "audio/wav") return unsupported();
  if (bytes.byteLength > MAX_RECORDING_BYTES) return tooLong();
  if (bytes.byteLength < HEADER_BYTES + BLOCK_ALIGN) return invalid();
  if (!ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "WAVE")) return invalid();
  if (!ascii(bytes, 12, "fmt ")) return unsupported();
  if (u32(bytes, 16) !== FMT_CHUNK_BYTES) return unsupported();
  if (
    u16(bytes, 20) !== PCM_FORMAT ||
    u16(bytes, 22) !== MONO_CHANNELS ||
    u32(bytes, 24) !== SAMPLE_RATE ||
    u32(bytes, 28) !== BYTE_RATE ||
    u16(bytes, 32) !== BLOCK_ALIGN ||
    u16(bytes, 34) !== BITS_PER_SAMPLE
  )
    return unsupported();
  if (!ascii(bytes, 36, "data")) return unsupported();
  const dataBytes = u32(bytes, 40);
  const riffBytes = u32(bytes, 4);
  if (dataBytes === 0 || dataBytes % BLOCK_ALIGN !== 0) return invalid();
  if (bytes.byteLength !== HEADER_BYTES + dataBytes) return invalid();
  if (riffBytes !== bytes.byteLength - 8) return invalid();
  const samples = dataBytes / BLOCK_ALIGN;
  if (samples > MAX_SAMPLES) return tooLong();
  const durationMs = Math.ceil(samples / SAMPLES_PER_MILLISECOND);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) return invalid();
  if (durationMs > MAX_RECORDING_MS) return tooLong();
  return { ok: true, durationMs };
};
