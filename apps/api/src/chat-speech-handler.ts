/**
 * Public native speech route entry.
 *
 * The parent integration resolves the authenticated CurrentUser and the derived
 * server stage, then dispatches the two fixed operation paths here. Nothing in
 * this module trusts browser-supplied destinations or credentials.
 */
import { speakSpeechOperation, transcribeSpeechOperation } from "./chat-speech-operations.ts";
import type { SpeechHandlerContext, SpeechHandlerServices } from "./chat-speech-support.ts";
import { speechResponse } from "./chat-speech-response.ts";

export type { SpeechHandlerContext, SpeechHandlerServices };

export const SPEECH_TRANSCRIBE_PATH = "/api/chat/speech/transcribe";
export const SPEECH_SPEAK_PATH = "/api/chat/speech/speak";

export const isSpeechOperationPath = (pathname: string): boolean =>
  pathname === SPEECH_TRANSCRIBE_PATH || pathname === SPEECH_SPEAK_PATH;

/** Dispatches one authenticated speech operation; the caller owns routing. */
export const handleSpeechRequest = async (
  request: Request,
  context: SpeechHandlerContext,
  services: SpeechHandlerServices,
): Promise<Response> => {
  const pathname = new URL(request.url).pathname;
  if (pathname === SPEECH_TRANSCRIBE_PATH) {
    if (request.method !== "POST")
      return speechResponse(405, "method_not_allowed", "Use POST for transcription.");
    return transcribeSpeechOperation(request, context, services);
  }
  if (pathname === SPEECH_SPEAK_PATH) {
    if (request.method !== "POST")
      return speechResponse(405, "method_not_allowed", "Use POST for read aloud.");
    return speakSpeechOperation(request, context, services);
  }
  return speechResponse(404, "not_found", "Not found.");
};
