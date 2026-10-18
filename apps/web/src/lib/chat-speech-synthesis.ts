/**
 * Real assistant-ui speech-synthesis adapter over the chunked playback plan.
 *
 * The server reads the authoritative saved selection for every request, so the
 * browser never sends a model or voice. The adapter exposes only the
 * assistant-ui utterance contract; playback status flows to the bundle state
 * for the visible Stop control and skipped-code note.
 */
import type { SpeechSynthesisAdapter } from "@assistant-ui/react";
import { newOperationId } from "@/lib/chat-api";
import type { SpeechAudioCall } from "@/lib/chat-speech-client";
import {
  startSpeechPlayback,
  type SpeechPlaybackControl,
  type SpeechPlaybackStatus,
} from "@/lib/chat-speech-speech";

export type SpeechSynthesisDeps = {
  readonly getChatId: () => string | null;
  readonly requestAudio: SpeechAudioCall;
  readonly stopPlayback: () => void;
  readonly onStatus: (status: SpeechPlaybackStatus) => void;
  readonly onActive: (control: SpeechPlaybackControl | null) => void;
  readonly unavailable: () => boolean;
};

export const createSpeechSynthesis = (deps: SpeechSynthesisDeps): SpeechSynthesisAdapter => ({
  speak: (text: string): SpeechSynthesisAdapter.Utterance => {
    deps.stopPlayback();
    let status: SpeechSynthesisAdapter.Status = { type: "starting" };
    const subscribers = new Set<() => void>();
    const emit = (): void => {
      for (const subscriber of subscribers) subscriber();
    };
    if (deps.unavailable()) {
      status = { type: "ended", reason: "error", error: new Error("Read aloud is unavailable.") };
      return {
        get status(): SpeechSynthesisAdapter.Status {
          return status;
        },
        cancel: () => undefined,
        subscribe: () => () => undefined,
      };
    }
    let settled = false;
    let control: SpeechPlaybackControl | null = null;
    control = startSpeechPlayback({
      text,
      chatId: deps.getChatId(),
      requestAudio: deps.requestAudio,
      nextOperationId: newOperationId,
      onStatus: (next) => {
        if (next.phase === "ended") {
          settled = true;
          status = {
            type: "ended",
            reason: next.reason ?? "finished",
            ...(next.error !== null ? { error: new Error(next.error) } : {}),
          };
        } else {
          status = { type: next.phase === "starting" ? "starting" : "running" };
        }
        deps.onStatus(next);
        emit();
      },
    });
    if (!settled) deps.onActive(control);
    return {
      get status(): SpeechSynthesisAdapter.Status {
        return status;
      },
      cancel: () => {
        control?.cancel();
      },
      subscribe: (callback) => {
        subscribers.add(callback);
        return () => {
          subscribers.delete(callback);
        };
      },
    };
  },
});
