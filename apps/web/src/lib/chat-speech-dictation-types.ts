/**
 * Public dictation state and dependency shapes.
 *
 * Kept separate so the adapter module stays small and T23 can import the types
 * without pulling in the recorder implementation.
 */
import type { DictationAdapter } from "@assistant-ui/react";
import type { SpeechTranscribeCall } from "@/lib/chat-speech-client";

export const MAX_DICTATION_LEVELS = 48;

export type DictationPatch = {
  readonly phase?: "idle" | "starting" | "recording" | "transcribing";
  readonly elapsedMs?: number;
  readonly level?: number;
  readonly levels?: readonly number[];
  readonly limitReached?: "time" | null;
};

export type SpeechDictationDeps = {
  readonly getChatId: () => string | null;
  readonly transcribe: SpeechTranscribeCall;
  readonly stopPlayback: () => void;
  readonly onState: (patch: DictationPatch) => void;
  readonly onError: (message: string | null) => void;
};

export type SpeechDictation = {
  readonly adapter: DictationAdapter;
  readonly stop: () => void;
  readonly cancel: () => void;
  readonly dispose: () => void;
};
