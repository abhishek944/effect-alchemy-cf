/**
 * Authenticated native speech operations.
 *
 * Model and voice always come from saved server preferences. Ownership and the
 * durable one-attempt claim resolve before the provider request, so duplicate,
 * uncertain, unowned or over-limit operations fail closed without another paid
 * attempt. Usage keeps real units, including provider-reported seconds/tokens
 * from a failed attempt, and TTS characters are an honest estimate.
 */
import { speechSynthesisWithinLimit } from "./chat-speech-schema.ts";
import { reportFailure } from "@starter/diagnostics";
import { fingerprintSpeech } from "./chat-speech-fingerprint.ts";
import {
  SpeechTransportError,
  synthesizeSpeech,
  transcribeAudio,
  type TranscriptionResult,
} from "./chat-speech-transport.ts";
import { readSpeakRequest, readTranscriptionRequest } from "./chat-speech-request.ts";
import {
  admitSpeechOperation,
  prepareSpeechOperation,
  recordSpeechUsage,
  settleSpeechOperation,
  type SpeechHandlerContext,
  type SpeechHandlerServices,
  type SpeechUsageBase,
} from "./chat-speech-support.ts";
import type { SpeechUsageUnit } from "./chat-speech-usage.ts";
import {
  speechJson,
  speechResponse,
  speechTransportFailure,
  speechWireFailure,
} from "./chat-speech-response.ts";

/** Persists the operation-keyed Unknown attempt before any provider work. */
const persistAttempt = (
  services: SpeechHandlerServices,
  base: SpeechUsageBase,
  unit: SpeechUsageUnit,
): Promise<Response | null> =>
  recordSpeechUsage(services, base, { unit, failed: true, reported: null, estimated: null });

export const transcribeSpeechOperation = async (
  request: Request,
  context: SpeechHandlerContext,
  services: SpeechHandlerServices,
): Promise<Response> => {
  const read = await readTranscriptionRequest(request);
  if (!read.ok) return speechWireFailure(read.failure);
  const prepared = prepareSpeechOperation(context);
  if (!prepared.ok) return prepared.response;
  const input = read.value;
  const admission = await admitSpeechOperation(context, services, {
    operationId: input.operationId,
    kind: "transcription",
    chatId: input.chatId,
    playbackId: null,
    inputFingerprint: await fingerprintSpeech([String(input.measuredDurationMs), input.audio]),
  });
  if (!admission.ok) return admission.response;
  const model = admission.preferences.transcriptionModel;
  const base: SpeechUsageBase = {
    operationId: input.operationId,
    chatId: input.chatId,
    kind: "transcription",
    model,
    voice: null,
  };
  const pending = await persistAttempt(services, base, "audio_seconds");
  if (pending !== null) {
    await settleSpeechOperation(services, admission.claimId, "failed", input.operationId);
    return pending;
  }
  let result: TranscriptionResult;
  try {
    result = await transcribeAudio(prepared.runtime, { model, audio: input.audio }, request.signal);
  } catch (error) {
    reportFailure(error, {
      component: "chat-speech",
      operation: "transcribe",
      operationId: input.operationId,
      event:
        error instanceof SpeechTransportError && error.code === "cancelled"
          ? "application.cancelled"
          : "application.failure",
    });
    await settleSpeechOperation(services, admission.claimId, "failed", input.operationId);
    const reported = error instanceof SpeechTransportError ? error.reported : null;
    await recordSpeechUsage(services, base, {
      unit: reported?.unit ?? "audio_seconds",
      failed: true,
      reported: reported?.quantity ?? null,
      estimated: null,
    });
    return speechTransportFailure(error);
  }
  const reported = result.reported;
  await recordSpeechUsage(
    services,
    base,
    {
      unit: reported?.unit ?? "audio_seconds",
      failed: false,
      reported: reported?.quantity ?? null,
      estimated: reported === null ? input.measuredDurationMs / 1000 : null,
    },
    "WARN",
  );
  await settleSpeechOperation(services, admission.claimId, "completed", input.operationId);
  return speechJson({ text: result.text });
};

export const speakSpeechOperation = async (
  request: Request,
  context: SpeechHandlerContext,
  services: SpeechHandlerServices,
): Promise<Response> => {
  const read = await readSpeakRequest(request);
  if (!read.ok) return speechWireFailure(read.failure);
  const prepared = prepareSpeechOperation(context);
  if (!prepared.ok) return prepared.response;
  const input = read.value;
  if (
    !speechSynthesisWithinLimit({
      characters: input.text.length,
      estimatedTokens: Math.max(1, Math.ceil(input.text.length / 3)),
    })
  )
    return speechResponse(
      400,
      "invalid_request",
      "This text is too long to read aloud in one request.",
    );
  const admission = await admitSpeechOperation(context, services, {
    operationId: input.operationId,
    kind: "synthesis",
    chatId: input.chatId ?? null,
    playbackId: input.playbackId,
    inputFingerprint: await fingerprintSpeech([input.text]),
  });
  if (!admission.ok) return admission.response;
  const model = admission.preferences.speechModel;
  const voice = admission.preferences.voice;
  const base: SpeechUsageBase = {
    operationId: input.operationId,
    chatId: input.chatId ?? null,
    kind: "synthesis",
    model,
    voice,
  };
  const pending = await persistAttempt(services, base, "characters");
  if (pending !== null) {
    await settleSpeechOperation(services, admission.claimId, "failed", input.operationId);
    return pending;
  }
  let result: Awaited<ReturnType<typeof synthesizeSpeech>>;
  try {
    result = await synthesizeSpeech(
      prepared.runtime,
      { model, voice, text: input.text },
      request.signal,
    );
  } catch (error) {
    reportFailure(error, {
      component: "chat-speech",
      operation: "speak",
      operationId: input.operationId,
      event:
        error instanceof SpeechTransportError && error.code === "cancelled"
          ? "application.cancelled"
          : "application.failure",
    });
    await settleSpeechOperation(services, admission.claimId, "failed", input.operationId);
    return speechTransportFailure(error);
  }
  await recordSpeechUsage(
    services,
    base,
    { unit: "characters", failed: false, reported: null, estimated: input.text.length },
    "WARN",
  );
  await settleSpeechOperation(services, admission.claimId, "completed", input.operationId);
  return new Response(result.audio, {
    status: 200,
    headers: {
      "content-type": result.contentType,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
};
