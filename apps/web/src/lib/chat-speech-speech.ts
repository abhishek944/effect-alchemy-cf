/**
 * Local read-aloud playback over the bounded ordered prose chunks.
 *
 * One reply plays at a time; stop or a chunk failure prevents later paid chunks
 * and revokes every created object URL. A failed chunk surfaces a real error
 * instead of silently truncating the reply. Model and voice are chosen by the
 * server from saved preferences, so the request body never carries them.
 */
import {
  speechRequestError,
  type SpeechAudioInput,
  type SpeechAudioCall,
} from "@/lib/chat-speech-client";
import { planSpeech } from "@/lib/chat-speech-prose";

export type SpeechPlaybackStatus = {
  readonly phase: "starting" | "running" | "ended";
  readonly reason: "finished" | "cancelled" | "error" | null;
  readonly error: string | null;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly skippedCode: boolean;
};

export type SpeechPlaybackControl = { readonly cancel: () => void };

export type SpeechPlaybackOptions = {
  readonly text: string;
  readonly chatId: string | null;
  readonly requestAudio: SpeechAudioCall;
  readonly nextOperationId: () => string;
  readonly onStatus: (status: SpeechPlaybackStatus) => void;
};

export const startSpeechPlayback = (options: SpeechPlaybackOptions): SpeechPlaybackControl => {
  const plan = planSpeech(options.text);
  const count = plan.chunks.length;
  const skippedCode = plan.skippedCode;
  const status = (
    phase: SpeechPlaybackStatus["phase"],
    reason: SpeechPlaybackStatus["reason"],
    error: string | null,
    chunkIndex: number,
  ): SpeechPlaybackStatus => ({ phase, reason, error, chunkIndex, chunkCount: count, skippedCode });
  if (count === 0) {
    options.onStatus(status("ended", "error", "This reply has no speakable text.", 0));
    return { cancel: () => undefined };
  }
  let cancelled = false;
  let index = 0;
  const playbackId = options.nextOperationId();
  let controller: AbortController | null = null;
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  const releaseAudio = (): void => {
    if (audio !== null) {
      audio.pause();
      audio.removeAttribute("src");
      audio = null;
    }
    if (url !== null) {
      URL.revokeObjectURL(url);
      url = null;
    }
  };
  const finish = (reason: "cancelled" | "error", error: string | null): void => {
    if (cancelled) return;
    cancelled = true;
    controller?.abort();
    controller = null;
    releaseAudio();
    options.onStatus(status("ended", reason, error, index));
  };
  const run = async (): Promise<void> => {
    options.onStatus(status("starting", null, null, 0));
    for (index = 0; index < plan.chunks.length; index++) {
      if (cancelled) return;
      const text = plan.chunks[index];
      if (text === undefined) return;
      controller = new AbortController();
      let blob: Blob;
      try {
        const result = await options.requestAudio({
          operationId: options.nextOperationId(),
          chatId: options.chatId,
          playbackId,
          text,
          signal: controller.signal,
        } satisfies SpeechAudioInput);
        blob = result.blob;
      } catch (error) {
        finish("error", `Read aloud failed. ${speechRequestError(error)}`);
        return;
      }
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      const element = new Audio(url);
      audio = element;
      try {
        await new Promise<void>((resolve, reject) => {
          element.addEventListener("ended", () => resolve(), { once: true });
          element.addEventListener("error", () => reject(new Error("Playback failed.")), {
            once: true,
          });
          element.play().catch(reject);
        });
      } catch {
        finish("error", "Playback of the generated audio failed.");
        return;
      } finally {
        if (audio === element) audio = null;
        if (url !== null) {
          URL.revokeObjectURL(url);
          url = null;
        }
      }
      if (cancelled) return;
      options.onStatus(status("running", null, null, index + 1));
    }
    if (cancelled) return;
    cancelled = true;
    options.onStatus(status("ended", "finished", null, count));
  };
  void run();
  return {
    cancel: (): void => finish("cancelled", null),
  };
};
