/**
 * Local canonical WAV encoding for dictation.
 *
 * The recorder keeps native MediaRecorder capture (WebM/MP4/Ogg). Before
 * upload, this module decodes that transient recording with the platform
 * decoder, verifies the real duration, resamples to mono 16 kHz through an
 * OfflineAudioContext and writes one strict 44-byte-header PCM16LE WAV. No
 * provider, speech service or browser inference is involved - only local
 * encoding of the same transient recording. Owned contexts are closed and
 * stale buffers are dropped; the signal is rechecked after every async step.
 */
import { MAX_RECORDING_BYTES, MAX_RECORDING_MS } from "@/lib/chat-capability-speech-types";

export type WavSupport = {
  readonly supported: boolean;
  readonly reason: string | null;
};

export const canonicalWavSupport = (): WavSupport => {
  if (typeof window === "undefined") return { supported: false, reason: null };
  if (typeof AudioContext === "undefined" || typeof OfflineAudioContext === "undefined")
    return {
      supported: false,
      reason: "This browser cannot decode recorded audio for transcription.",
    };
  return { supported: true, reason: null };
};

const SAMPLE_RATE = 16_000;
const HEADER_BYTES = 44;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;

const aborted = (): DOMException => new DOMException("Aborted", "AbortError");

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw aborted();
};

const ascii = (bytes: Uint8Array, offset: number, text: string): void => {
  for (let index = 0; index < text.length; index++) {
    bytes[offset + index] = text.charCodeAt(index);
  }
};

/** Exact canonical header: RIFF/WAVE, PCM, mono, 16 kHz, 16-bit, tight data. */
export const encodeCanonicalWav = async (
  recording: Blob,
  signal: AbortSignal | undefined,
): Promise<Blob> => {
  throwIfAborted(signal);
  // The over-limit original is rejected before any decoder allocation, so a
  // smaller normalized WAV can never hide the raw capture-byte quota.
  if (recording.size > MAX_RECORDING_BYTES)
    throw new Error("The recording is too large to transcribe.");
  const support = canonicalWavSupport();
  if (!support.supported) throw new Error(support.reason ?? "Recording conversion is unavailable.");
  const decode = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decode.decodeAudioData(await recording.arrayBuffer());
  } finally {
    void decode.close().catch(() => undefined);
  }
  throwIfAborted(signal);
  if (!Number.isFinite(decoded.duration) || decoded.duration <= 0)
    throw new Error("The recording could not be decoded.");
  if (decoded.duration > MAX_RECORDING_MS / 1000)
    throw new Error("Recordings are limited to two minutes.");
  const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
  const offline = new OfflineAudioContext(CHANNELS, frames, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  throwIfAborted(signal);
  const samples = rendered.getChannelData(0);
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  ascii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(bytes, 8, "WAVE");
  ascii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  ascii(bytes, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = HEADER_BYTES;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += BYTES_PER_SAMPLE;
  }
  return new Blob([bytes], { type: "audio/wav" });
};
