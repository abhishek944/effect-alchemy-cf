/**
 * Bounded transient microphone recording with exception-safe acquisition.
 *
 * One session is capped at two minutes or 10 MiB. A chunk that would cross the
 * byte ceiling is never retained: the whole recording fails explicitly and the
 * retained audio is dropped instead of producing a truncated transcript. Every
 * failure after the microphone is acquired runs one idempotent rollback that
 * stops all tracks, clears the timer/animation and closes every created context
 * before rethrowing; the handle is returned only after startup succeeds.
 * Recorded bytes stay in memory only and are never handed on over the ceiling.
 */
import { MAX_RECORDING_BYTES, MAX_RECORDING_MS } from "@/lib/chat-capability-speech-types";
import {
  preferredRecorderType,
  speechDictationSupport,
  type RecordingCallbacks,
  type RecordedAudio,
  type VoiceRecording,
} from "@/lib/chat-speech-recorder-support";

export { preferredRecorderType, speechDictationSupport } from "@/lib/chat-speech-recorder-support";
export type {
  DictationSupport,
  RecordedAudio,
  RecordingCallbacks,
  VoiceRecording,
} from "@/lib/chat-speech-recorder-support";

const microphoneError = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError")
      return "Microphone access was blocked. Allow it in your browser and try again.";
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError")
      return "No microphone was found for recording.";
    if (error.name === "NotReadableError")
      return "The microphone is already used by another application.";
  }
  return "The microphone could not be started.";
};

const startError = (error: unknown): Error =>
  new Error("The browser could not start audio recording.", { cause: error });

export const startVoiceRecording = async (
  callbacks: RecordingCallbacks,
): Promise<VoiceRecording> => {
  const support = speechDictationSupport();
  if (!support.supported) throw new Error(support.reason ?? "Recording is unavailable.");
  const mediaType = preferredRecorderType();
  if (mediaType === null) throw new Error("This browser has no supported audio recording format.");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    throw new Error(microphoneError(error), { cause: error });
  }
  const chunks: Blob[] = [];
  let bytes = 0;
  let cancelled = false;
  let released = false;
  let settled = false;
  let overflow = false;
  let limited = false;
  let result: RecordedAudio | null = null;
  let timer = 0;
  let frame = 0;
  let context: AudioContext | null = null;
  const startedAt = Date.now();
  const releaseStream = (): void => {
    if (released) return;
    released = true;
    for (const track of stream.getTracks()) track.stop();
  };
  const closeContext = (): void => {
    const closing = context;
    context = null;
    if (closing !== null) void closing.close().catch(() => undefined);
  };
  /** One idempotent owner for every acquired resource. */
  const release = (): void => {
    if (timer !== 0) {
      window.clearInterval(timer);
      timer = 0;
    }
    if (frame !== 0) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
    releaseStream();
    closeContext();
  };
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: mediaType });
  } catch (error) {
    release();
    throw startError(error);
  }
  const stopped = new Promise<void>((resolve) => {
    recorder.addEventListener("stop", () => resolve(), { once: true });
  });
  const endCapture = (): void => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  try {
    recorder.addEventListener("dataavailable", (event) => {
      if (cancelled || overflow || event.data.size === 0) return;
      if (bytes + event.data.size > MAX_RECORDING_BYTES) {
        // Explicit rejection, not truncation: the crossing chunk is never
        // retained and the whole recording becomes inadmissible.
        overflow = true;
        chunks.length = 0;
        bytes = 0;
        releaseStream();
        endCapture();
        callbacks.onError(
          "The recording went over 10 MiB and was discarded. Record a shorter clip.",
        );
        return;
      }
      bytes += event.data.size;
      chunks.push(event.data);
    });
    recorder.addEventListener("error", () => {
      if (cancelled || settled) return;
      callbacks.onError("Recording stopped because the browser reported an audio error.");
      endCapture();
    });
    for (const track of stream.getAudioTracks())
      track.addEventListener("ended", () => {
        if (released || cancelled || settled) return;
        callbacks.onStreamEnded();
        endCapture();
      });
    timer = window.setInterval(() => {
      if (cancelled || settled || limited) return;
      const elapsed = Date.now() - startedAt;
      callbacks.onTick(elapsed);
      if (elapsed >= MAX_RECORDING_MS) {
        limited = true;
        releaseStream();
        endCapture();
        callbacks.onLimit("time");
      }
    }, 250);
    try {
      context = new AudioContext();
      void context.resume().catch(() => undefined);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const meter = (): void => {
        if (cancelled || settled) return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        callbacks.onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
        frame = window.requestAnimationFrame(meter);
      };
      frame = window.requestAnimationFrame(meter);
    } catch {
      closeContext();
    }
    recorder.start(1000);
  } catch (error) {
    release();
    throw startError(error);
  }
  const cancelRecording = (): void => {
    if (cancelled) return;
    cancelled = true;
    endCapture();
    release();
    chunks.length = 0;
    bytes = 0;
  };
  return {
    stop: async (): Promise<RecordedAudio | null> => {
      if (settled) return result;
      settled = true;
      endCapture();
      await stopped;
      release();
      if (cancelled || overflow || bytes > MAX_RECORDING_BYTES || chunks.length === 0) return null;
      result = { blob: new Blob(chunks, { type: mediaType }), mediaType };
      return result;
    },
    cancel: cancelRecording,
    dispose: cancelRecording,
  };
};
