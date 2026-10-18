/**
 * Per-operation speech attribution contract.
 *
 * Speech billing units stay separate from chat token accounting: transcription
 * is audio seconds and synthesis is characters. A provider-reported quantity is
 * used when present; otherwise a bounded caller estimate is recorded as
 * `estimated`; when neither exists the operation is `unknown` rather than a
 * fabricated zero. The recorder is supplied by the parent integration and is
 * the only consumer of this data - no audio, transcript or spoken text is ever
 * part of a usage record.
 */
import type { SpeechUsage } from "./chat-usage-schema.ts";

/** Durable attribution for one real speech operation attempt. */
export type SpeechUsageRecorder = (usage: SpeechUsage) => Promise<void>;

export type SpeechUsageKind = "transcription" | "synthesis";
export type SpeechUsageUnit = "audio_seconds" | "characters" | "tokens";

export type SpeechUsageInput = {
  readonly operationId: string;
  readonly chatId: string | null;
  readonly kind: SpeechUsageKind;
  readonly model: string;
  readonly voice: string | null;
  readonly unit: SpeechUsageUnit;
  /** Exact provider-reported quantity, or null when it was not reported. */
  readonly reportedQuantity: number | null;
  /** Bounded caller estimate, used only when nothing was reported. */
  readonly estimatedQuantity: number | null;
  /** True when the operation reached the provider but did not complete. */
  readonly failed: boolean;
};

const unknownUsage = (input: SpeechUsageInput): SpeechUsage => ({
  operationId: input.operationId,
  chatId: input.chatId,
  kind: input.kind,
  model: input.model,
  voice: input.voice,
  unit: input.unit,
  quantity: null,
  estimatedCostUsd: null,
  provenance: "unknown",
  completeness: "unknown",
});

/**
 * Builds the schema-valid usage record. Provider-reported counters survive a
 * failed attempt as `reported`/`partial` rather than being flattened to
 * Unknown. A bounded estimate is `estimated`/`partial`; only genuinely
 * unmeasured work is Unknown, and no price is ever invented.
 */
export const speechUsageOf = (input: SpeechUsageInput): SpeechUsage => {
  const reported =
    input.reportedQuantity !== null && Number.isFinite(input.reportedQuantity)
      ? input.reportedQuantity
      : null;
  if (reported !== null)
    return {
      operationId: input.operationId,
      chatId: input.chatId,
      kind: input.kind,
      model: input.model,
      voice: input.voice,
      unit: input.unit,
      quantity: reported,
      estimatedCostUsd: null,
      provenance: "reported",
      completeness: "partial",
    };
  if (input.failed) return unknownUsage(input);
  const estimated =
    input.estimatedQuantity !== null && Number.isFinite(input.estimatedQuantity)
      ? input.estimatedQuantity
      : null;
  if (estimated === null) return unknownUsage(input);
  return {
    operationId: input.operationId,
    chatId: input.chatId,
    kind: input.kind,
    model: input.model,
    voice: input.voice,
    unit: input.unit,
    quantity: estimated,
    estimatedCostUsd: null,
    provenance: "estimated",
    completeness: "partial",
  };
};
