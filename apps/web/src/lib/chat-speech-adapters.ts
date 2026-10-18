// oxlint-disable react/refs -- latest adapter options are read only inside callbacks
/**
 * Assistant-ui speech adapter bundle.
 *
 * T23 supplies this to `useExternalStoreRuntime({ adapters: { dictation,
 * speech } })` and renders `VoiceRecorder` from it. The hook's effect is
 * replay-safe (setup resume, cleanup cancel), and the server remains the
 * authority for the saved speech preferences of every operation.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ChatSpeechPreferences } from "@/lib/chat-capability-speech-types";
import {
  requestSpeechAudio,
  transcribeRecording,
  type SpeechAudioCall,
  type SpeechTranscribeCall,
} from "@/lib/chat-speech-client";
import { createSpeechDictation } from "@/lib/chat-speech-dictation";
import type { DictationPatch } from "@/lib/chat-speech-dictation-types";
import type { SpeechPlaybackControl, SpeechPlaybackStatus } from "@/lib/chat-speech-speech";
import { createSpeechSynthesis } from "@/lib/chat-speech-synthesis";
import type { DictationAdapter, SpeechSynthesisAdapter } from "@assistant-ui/react";

export { speechDictationSupport } from "@/lib/chat-speech-recorder";

export type SpeechDictationState = {
  readonly phase: "idle" | "starting" | "recording" | "transcribing";
  readonly elapsedMs: number;
  readonly level: number;
  readonly levels: readonly number[];
  readonly limitReached: "time" | null;
};

export type SpeechPlaybackState = {
  readonly phase: "idle" | "preparing" | "playing";
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly skippedCode: boolean;
};

export type SpeechAdapterState = {
  readonly dictation: SpeechDictationState;
  readonly playback: SpeechPlaybackState;
  readonly error: string | null;
};

export type SpeechAdaptersOptions = {
  /**
   * UI-facing saved selection. The server read is authoritative for every
   * operation, so the wire body never carries a model or voice.
   */
  readonly getPreferences?: () => ChatSpeechPreferences;
  readonly chatId?: () => string | null;
  readonly transcribe?: SpeechTranscribeCall;
  readonly speak?: SpeechAudioCall;
};

export type SpeechAdapterBundle = {
  readonly dictation: DictationAdapter;
  readonly speech: SpeechSynthesisAdapter;
  readonly getState: () => SpeechAdapterState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly stopDictation: () => void;
  readonly cancelDictation: () => void;
  readonly stopPlayback: () => void;
  readonly dismissError: () => void;
  /** Releases active recording/upload/playback and fences late results. */
  readonly cancel: () => void;
  /** Reopens a disposed bundle on mount; setup side of a StrictMode replay. */
  readonly resume: () => void;
  readonly dispose: () => void;
};

const initialState = (): SpeechAdapterState => ({
  dictation: { phase: "idle", elapsedMs: 0, level: 0, levels: [], limitReached: null },
  playback: { phase: "idle", chunkIndex: 0, chunkCount: 0, skippedCode: false },
  error: null,
});

export const createSpeechAdapters = (options: SpeechAdaptersOptions): SpeechAdapterBundle => {
  const transcribe = options.transcribe ?? transcribeRecording;
  const requestAudio = options.speak ?? requestSpeechAudio;
  const listeners = new Set<() => void>();
  let state = initialState();
  let closed = false;
  let playback: SpeechPlaybackControl | null = null;
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const patch = (next: Partial<SpeechAdapterState>): void => {
    state = { ...state, ...next };
    notify();
  };
  const patchDictation = (next: DictationPatch): void => {
    patch({ dictation: { ...state.dictation, ...next } });
  };
  const patchPlayback = (next: Partial<SpeechPlaybackState>): void => {
    patch({ playback: { ...state.playback, ...next } });
  };
  const setError = (error: string | null): void => patch({ error });
  const stopPlayback = (): void => {
    playback?.cancel();
    playback = null;
    patchPlayback({ phase: "idle" });
  };
  const onPlaybackStatus = (status: SpeechPlaybackStatus): void => {
    if (status.phase === "ended") {
      playback = null;
      patchPlayback({ phase: "idle" });
      if (status.reason === "error" && status.error !== null) setError(status.error);
      return;
    }
    setError(null);
    patchPlayback({
      phase: status.phase === "starting" ? "preparing" : "playing",
      chunkIndex: status.chunkIndex,
      chunkCount: status.chunkCount,
      skippedCode: status.skippedCode,
    });
  };
  const dictation = createSpeechDictation({
    getChatId: () => options.chatId?.() ?? null,
    transcribe,
    stopPlayback,
    onState: patchDictation,
    onError: setError,
  });
  const speech = createSpeechSynthesis({
    getChatId: () => options.chatId?.() ?? null,
    requestAudio,
    stopPlayback,
    onStatus: onPlaybackStatus,
    onActive: (control) => {
      playback = control;
    },
    unavailable: () => closed,
  });
  const dictationAdapter: DictationAdapter = {
    listen: () => {
      if (closed) throw new Error("Speech is unavailable.");
      return dictation.adapter.listen();
    },
  };
  const cancel = (): void => {
    playback?.cancel();
    playback = null;
    dictation.dispose();
    state = initialState();
    notify();
  };
  return {
    dictation: dictationAdapter,
    speech,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stopDictation: dictation.stop,
    cancelDictation: dictation.cancel,
    stopPlayback,
    dismissError: () => setError(null),
    cancel,
    resume: (): void => {
      closed = false;
    },
    dispose: (): void => {
      cancel();
      closed = true;
      listeners.clear();
    },
  };
};

/** Stable bundle for one mounted conversation; disposed on unmount. */
export const useSpeechAdapters = (options: SpeechAdaptersOptions): SpeechAdapterBundle => {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const read = useCallback(() => latest.current, []);
  const bundle = useMemo(
    () =>
      createSpeechAdapters({
        chatId: () => read().chatId?.() ?? null,
        transcribe: (input) => (read().transcribe ?? transcribeRecording)(input),
        speak: (input) => (read().speak ?? requestSpeechAudio)(input),
      }),
    [read],
  );
  useEffect(() => {
    bundle.resume();
    return () => {
      bundle.cancel();
    };
  }, [bundle]);
  return bundle;
};
