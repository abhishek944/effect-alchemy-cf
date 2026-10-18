/**
 * Real assistant-ui dictation adapter: explicit mic start, one Stop
 * transcription into the editable draft, Cancel keeps typed text, and
 * permission loss, stale epochs or dispose cancel resources and late results.
 */
import type { DictationAdapter } from "@assistant-ui/react";
import { newOperationId } from "@/lib/chat-api";
import { MAX_RECORDING_MS } from "@/lib/chat-capability-speech-types";
import { speechRequestError } from "@/lib/chat-speech-client";
import {
  speechDictationSupport,
  startVoiceRecording,
  type VoiceRecording,
} from "@/lib/chat-speech-recorder";
import {
  MAX_DICTATION_LEVELS,
  type SpeechDictation,
  type SpeechDictationDeps,
} from "@/lib/chat-speech-dictation-types";

const startFailure = (error: unknown): string =>
  error instanceof Error && error.message !== ""
    ? error.message
    : "The microphone could not be started.";

export const createSpeechDictation = (deps: SpeechDictationDeps): SpeechDictation => {
  let epoch = 0;
  let active: { readonly stop: () => Promise<void>; readonly cancel: () => void } | null = null;

  const listen = (): DictationAdapter.Session => {
    deps.stopPlayback();
    const support = speechDictationSupport();
    if (!support.supported) throw new Error(support.reason ?? "Recording is unavailable.");
    const sessionEpoch = ++epoch;
    let status: DictationAdapter.Status = { type: "starting" };
    let ended = false;
    let stopping = false;
    let started = false;
    const delivery = { start: false, end: false };
    let startCallback: (() => void) | null = null;
    let endCallback: ((result: DictationAdapter.Result) => void) | null = null;
    let speechCallback: ((result: DictationAdapter.Result) => void) | null = null;
    let recording: VoiceRecording | null = null;
    let transcription: AbortController | null = null;
    const levels: number[] = [];
    const emitStart = (): void => {
      if (delivery.start) return;
      delivery.start = true;
      startCallback?.();
    };
    const emitEnd = (): void => {
      if (delivery.end) return;
      delivery.end = true;
      endCallback?.({ transcript: "" });
    };
    const finish = (reason: "stopped" | "cancelled" | "error", message: string | null): void => {
      if (ended) return;
      ended = true;
      status = { type: "ended", reason };
      recording?.cancel();
      recording = null;
      transcription?.abort();
      transcription = null;
      deps.onState({ phase: "idle", limitReached: null, level: 0 });
      if (message !== null) deps.onError(message);
      emitEnd();
      active = null;
    };
    const stop = async (): Promise<void> => {
      if (ended || stopping) return;
      stopping = true;
      if (recording === null) {
        finish("cancelled", null);
        return;
      }
      deps.onState({ phase: "transcribing" });
      let captured: Awaited<ReturnType<VoiceRecording["stop"]>>;
      try {
        captured = await recording.stop();
      } catch {
        finish("error", "The recording could not be finished.");
        return;
      } finally {
        recording = null;
      }
      if (ended || sessionEpoch !== epoch) return;
      if (captured === null || captured.blob.size === 0) {
        finish("error", "The recording was empty.");
        return;
      }
      const controller = new AbortController();
      transcription = controller;
      try {
        const result = await deps.transcribe({
          operationId: newOperationId(),
          chatId: deps.getChatId(),
          audio: captured.blob,
          signal: controller.signal,
        });
        if (ended || sessionEpoch !== epoch) return;
        const transcript = result.text.trim();
        if (transcript === "") {
          finish("error", "No speech was recognized in this recording.");
          return;
        }
        speechCallback?.({ transcript, isFinal: true });
      } catch (error) {
        if (ended || sessionEpoch !== epoch) return;
        finish("error", `Transcription failed. ${speechRequestError(error)}`);
        return;
      } finally {
        transcription = null;
      }
      finish("stopped", null);
    };
    const cancel = (): void => finish("cancelled", null);
    const session: DictationAdapter.Session = {
      get status(): DictationAdapter.Status {
        return status;
      },
      stop,
      cancel,
      onSpeechStart: (callback) => {
        startCallback = callback;
        if (started) emitStart();
        return () => {
          startCallback = null;
        };
      },
      onSpeechEnd: (callback) => {
        endCallback = callback;
        if (ended) emitEnd();
        return () => {
          endCallback = null;
        };
      },
      onSpeech: (callback) => {
        speechCallback = callback;
        return () => {
          speechCallback = null;
        };
      },
    };
    active = { stop, cancel };
    void (async () => {
      try {
        const startedRecording = await startVoiceRecording({
          onLevel: (level) => {
            levels.push(level);
            if (levels.length > MAX_DICTATION_LEVELS) levels.shift();
            deps.onState({ level, levels: [...levels] });
          },
          onTick: (elapsedMs) => deps.onState({ elapsedMs: Math.min(elapsedMs, MAX_RECORDING_MS) }),
          onLimit: (limit) => deps.onState({ limitReached: limit }),
          onStreamEnded: () => {
            if (!stopping) finish("error", "Microphone access ended. Your draft is unchanged.");
          },
          onError: (message) => {
            if (!stopping) finish("error", message);
          },
        });
        if (ended || sessionEpoch !== epoch) {
          startedRecording.cancel();
          return;
        }
        recording = startedRecording;
        started = true;
        status = { type: "running" };
        deps.onState({ phase: "recording" });
        deps.onError(null);
        emitStart();
      } catch (error) {
        if (ended || sessionEpoch !== epoch) return;
        finish("error", startFailure(error));
      }
    })();
    return session;
  };

  return {
    adapter: { listen },
    stop: (): void => {
      void active?.stop();
    },
    cancel: (): void => {
      active?.cancel();
    },
    /** Releases the active session and fences late results; replay-safe. */
    dispose: (): void => {
      epoch += 1;
      active?.cancel();
      active = null;
    },
  };
};
