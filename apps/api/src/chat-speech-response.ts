/**
 * Safe public speech responses.
 *
 * Every response is private and non-cacheable. Errors carry a stable code and a
 * message written for the user; upstream bodies, provider messages, provider
 * headers and the OpenRouter API key are never forwarded.
 */
import type { SpeechWireFailure } from "./chat-speech-request.ts";
import type { SpeechSetupFailure } from "./chat-speech-runtime.ts";
import { SpeechTransportError } from "./chat-speech-transport.ts";

export const SPEECH_SETUP_MESSAGES: Record<SpeechSetupFailure, string> = {
  not_configured:
    "A developer must configure the OpenRouter speech key. Then choose your models in Settings → Voice.",
  invalid_config: "The server's OpenRouter speech key is invalid. Contact your developer.",
  stage_not_allowed: "Speech is only available in development.",
};

export const speechResponse = (status: number, code: string, message: string): Response =>
  new Response(JSON.stringify({ message, code }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });

export const speechJson = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });

export const speechWireFailure = (failure: SpeechWireFailure): Response =>
  speechResponse(failure.status, failure.code, failure.message);

/** Maps a classified transport failure without echoing provider detail. */
export const speechTransportFailure = (error: unknown): Response => {
  if (error instanceof SpeechTransportError) {
    if (error.code === "timeout")
      return speechResponse(
        504,
        "provider_timeout",
        "The speech provider took too long. Try again.",
      );
    if (error.code === "upstream_rejected")
      return speechResponse(
        502,
        "provider_rejected",
        "The speech provider rejected this operation.",
      );
    if (error.code === "invalid_response")
      return speechResponse(
        502,
        "provider_invalid",
        "The speech provider returned an unexpected response.",
      );
    if (error.code === "cancelled")
      return speechResponse(499, "provider_cancelled", "The speech request was cancelled.");
  }
  return speechResponse(
    503,
    "provider_unavailable",
    "The speech provider is unavailable. Try again.",
  );
};
