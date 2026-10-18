/**
 * Full-width dictation region above the composer input.
 *
 * Renders nothing while idle, and a dismissible error row after a failed
 * operation. Recording shows real analyser levels, elapsed/max time, and
 * separately named Cancel and Stop controls; transcribing stays cancellable.
 * Stop transcribes once into the draft, Cancel discards the audio.
 */
import { useSyncExternalStore } from "react";
import { MAX_RECORDING_MS } from "@/lib/chat-capability-speech-types";
import type { SpeechAdapterBundle } from "@/lib/chat-speech-adapters";
import "./voice-recording.css";

const clock = (elapsedMs: number): string => {
  const total = Math.min(Math.floor(elapsedMs / 1000), MAX_RECORDING_MS / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const levelStep = (level: number): number => Math.min(8, Math.max(1, Math.round(level * 8)));

export default function VoiceRecorder({ bundle }: { readonly bundle: SpeechAdapterBundle }) {
  const state = useSyncExternalStore(bundle.subscribe, bundle.getState);
  const { phase, elapsedMs, level, levels, limitReached } = state.dictation;
  if (phase === "idle" && state.error === null) return null;
  const transcribing = phase === "transcribing";
  const caption = transcribing
    ? "Transcribing"
    : limitReached === "time"
      ? "Two-minute limit reached — stop to transcribe"
      : "Recording";
  return (
    <div data-cx="voice-recorder">
      {state.error !== null && (
        <p data-cx="voice-error" role="alert">
          <span>{state.error}</span>
          <button type="button" onClick={() => bundle.dismissError()}>
            Dismiss
          </button>
        </p>
      )}
      {phase !== "idle" && (
        <div data-cx="voice-row">
          <button
            aria-label={transcribing ? "Cancel transcription" : "Cancel recording"}
            data-cx="voice-circle"
            onClick={() => bundle.cancelDictation()}
            title={transcribing ? "Cancel transcription" : "Cancel recording"}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="m6 6 12 12M6 18 18 6" strokeWidth="1.75" />
            </svg>
          </button>
          <div data-cx="voice-wave" aria-hidden="true">
            {levels.map((value, index) => (
              <i data-level={levelStep(value)} key={index} />
            ))}
            {levels.length === 0 && <i data-level={levelStep(level)} />}
          </div>
          <button
            aria-label="Stop recording"
            data-cx="voice-circle"
            disabled={transcribing}
            onClick={() => bundle.stopDictation()}
            title="Stop recording"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
              <rect height="12" rx="1" width="12" x="6" y="6" />
            </svg>
          </button>
          <output data-cx="voice-caption">
            <span>{caption}</span>
            <span data-cx="voice-time">
              {clock(elapsedMs)} / {clock(MAX_RECORDING_MS)}
            </span>
          </output>
        </div>
      )}
    </div>
  );
}
