/**
 * Recording capability and shared transient-capture types.
 *
 * Capability is reported honestly: a missing MediaRecorder, a missing
 * getUserMedia, an unsupported recording format or a browser without native
 * audio decoding disables dictation with a reason instead of falling back to
 * another speech path. Native capture formats stay WebM/MP4/Ogg internally.
 */
import { canonicalWavSupport } from "@/lib/chat-speech-wav";

export type DictationSupport = {
  readonly supported: boolean;
  readonly reason: string | null;
};

const RECORDER_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

export const preferredRecorderType = (): string | null => {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of RECORDER_TYPES) if (MediaRecorder.isTypeSupported(type)) return type;
  return null;
};

export const speechDictationSupport = (): DictationSupport => {
  if (typeof window === "undefined" || typeof navigator === "undefined")
    return { supported: false, reason: "Recording is only available in the browser." };
  if (typeof MediaRecorder === "undefined")
    return { supported: false, reason: "This browser cannot record audio." };
  if (navigator.mediaDevices?.getUserMedia === undefined)
    return { supported: false, reason: "This browser cannot access a microphone." };
  if (preferredRecorderType() === null)
    return { supported: false, reason: "This browser has no supported audio recording format." };
  const decoding = canonicalWavSupport();
  if (!decoding.supported) return decoding;
  return { supported: true, reason: null };
};

export type RecordedAudio = {
  readonly blob: Blob;
  readonly mediaType: string;
};

export type RecordingCallbacks = {
  readonly onLevel: (level: number) => void;
  readonly onTick: (elapsedMs: number) => void;
  readonly onLimit: (limit: "time") => void;
  readonly onStreamEnded: () => void;
  readonly onError: (message: string) => void;
};

export type VoiceRecording = {
  readonly stop: () => Promise<RecordedAudio | null>;
  readonly cancel: () => void;
  readonly dispose: () => void;
};
