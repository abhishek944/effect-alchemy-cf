/**
 * Shared validation for one authenticated speech operation: the OpenRouter
 * binding resolves before the durable one-attempt claim, and the claim freezes
 * the authoritative model/voice for this operation or read-aloud playback.
 * Nothing here accepts a browser-supplied model, voice or destination.
 */
import type { SpeechPreferences } from "./chat-speech-schema.ts";
import { resolveSpeechRuntime, type SpeechRuntime } from "./chat-speech-runtime.ts";
import type {
  SpeechClaimDecision,
  SpeechClaimFailure,
  SpeechClaimOutcome,
  SpeechClaimRequest,
} from "./chat-speech-claims.ts";
import {
  speechUsageOf,
  type SpeechUsageInput,
  type SpeechUsageRecorder,
  type SpeechUsageUnit,
} from "./chat-speech-usage.ts";
import { SPEECH_SETUP_MESSAGES, speechResponse } from "./chat-speech-response.ts";

export type SpeechHandlerContext = {
  readonly userId: string;
  readonly stage: string;
  readonly env: Readonly<Record<string, unknown>>;
};

export type SpeechHandlerServices = {
  /** Confirms an optional chat id belongs to the authenticated owner. */
  readonly requireOwnedChat: (userId: string, chatId: string) => Promise<boolean>;
  /** Durable one-attempt admission; returns the frozen authoritative preferences. */
  readonly claimOperation: (request: SpeechClaimRequest) => Promise<SpeechClaimDecision>;
  readonly settleOperation: (claimId: string, outcome: SpeechClaimOutcome) => Promise<void>;
  readonly recordUsage: SpeechUsageRecorder;
};

export type PreparedSpeech =
  | { readonly ok: true; readonly runtime: SpeechRuntime }
  | { readonly ok: false; readonly response: Response };

export const prepareSpeechOperation = (context: SpeechHandlerContext): PreparedSpeech => {
  const resolution = resolveSpeechRuntime(context.env, context.stage);
  if (!resolution.ok)
    return {
      ok: false,
      response: speechResponse(503, "speech_unavailable", SPEECH_SETUP_MESSAGES[resolution.code]),
    };
  return { ok: true, runtime: resolution.runtime };
};

const CLAIM_FAILURES: Record<
  SpeechClaimFailure,
  { readonly status: number; readonly code: string; readonly message: string }
> = {
  duplicate: {
    status: 409,
    code: "operation_consumed",
    message: "This speech operation was already submitted. Start a new one.",
  },
  conflict: {
    status: 409,
    code: "operation_conflict",
    message: "This speech session no longer matches its saved operation. Start a new one.",
  },
  busy: {
    status: 429,
    code: "speech_busy",
    message: "Another speech operation is still running. Wait for it to finish.",
  },
  rate_limited: {
    status: 429,
    code: "rate_limited",
    message: "Too many speech requests. Wait a moment and try again.",
  },
  unavailable: {
    status: 503,
    code: "speech_unavailable",
    message: "Speech admission is unavailable. Try again.",
  },
};

export type SpeechAdmission =
  | { readonly ok: true; readonly claimId: string; readonly preferences: SpeechPreferences }
  | { readonly ok: false; readonly response: Response };

/** Ownership and the durable claim, including frozen preferences, settle first. */
export const admitSpeechOperation = async (
  context: SpeechHandlerContext,
  services: SpeechHandlerServices,
  request: Omit<SpeechClaimRequest, "userId">,
): Promise<SpeechAdmission> => {
  if (request.chatId !== null) {
    let owned = false;
    try {
      owned = await services.requireOwnedChat(context.userId, request.chatId);
    } catch {
      owned = false;
    }
    if (!owned)
      return {
        ok: false,
        response: speechResponse(404, "chat_not_found", "This chat is no longer available."),
      };
  }
  let decision: SpeechClaimDecision;
  try {
    decision = await services.claimOperation({ ...request, userId: context.userId });
  } catch {
    return {
      ok: false,
      response: speechResponse(
        503,
        CLAIM_FAILURES.unavailable.code,
        CLAIM_FAILURES.unavailable.message,
      ),
    };
  }
  if (decision.ok)
    return { ok: true, claimId: decision.claimId, preferences: decision.preferences };
  const failure = CLAIM_FAILURES[decision.code];
  return { ok: false, response: speechResponse(failure.status, failure.code, failure.message) };
};

/** Best effort: an unsettled claim stays consumed and blocks another paid attempt. */
export const settleSpeechOperation = async (
  services: SpeechHandlerServices,
  claimId: string,
  outcome: SpeechClaimOutcome,
): Promise<void> => {
  try {
    await services.settleOperation(claimId, outcome);
  } catch {
    // Intentionally ignored: the durable in-flight claim becomes stale/uncertain
    // and still prevents a retry, which is the fail-closed direction.
  }
};

/** Base identity shared by both operations; unit and quantities are per attempt. */
export type SpeechUsageBase = Omit<
  SpeechUsageInput,
  "reportedQuantity" | "estimatedQuantity" | "failed" | "unit"
>;

/** Maps one completed/failed attempt onto the schema-valid usage record. */
export const recordSpeechUsage = (
  services: SpeechHandlerServices,
  base: SpeechUsageBase,
  values: {
    readonly unit: SpeechUsageUnit;
    readonly failed: boolean;
    readonly reported: number | null;
    readonly estimated: number | null;
  },
): Promise<Response | null> =>
  attributeSpeechUsage(services, {
    ...base,
    unit: values.unit,
    reportedQuantity: values.reported,
    estimatedQuantity: values.estimated,
    failed: values.failed,
  });

/** Records a speech operation; failed attribution fails the response closed. */
export const attributeSpeechUsage = async (
  services: SpeechHandlerServices,
  input: SpeechUsageInput,
): Promise<Response | null> => {
  try {
    await services.recordUsage(speechUsageOf(input));
    return null;
  } catch {
    return speechResponse(
      503,
      "attribution_unavailable",
      "The speech operation could not be attributed. Try again.",
    );
  }
};
