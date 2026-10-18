/**
 * Manual validators for chat-attributable speech usage. Quantities stay null
 * when unknown, units remain real audio/character/token billing units, and an
 * incomplete speech total is never presented as a known zero.
 */
import type {
  ChatSpeechKind,
  ChatSpeechUnit,
  ChatSpeechUsage,
  ChatSpeechUsageTotal,
  ChatSpeechUsageTotals,
  ChatUsageCompleteness,
  ChatUsageProvenance,
} from "@/lib/chat-capability-usage-types";
import { SPEECH_KINDS, SPEECH_UNITS } from "@/lib/chat-capability-usage-types";
import { listed } from "@/lib/chat-capability-validate";
import { isRecord, isText, isUuid } from "@/lib/chat-validate-base";

const isAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isProvenance = (value: unknown): value is ChatUsageProvenance =>
  value === "reported" || value === "estimated" || value === "unknown";
const isCompleteness = (value: unknown): value is ChatUsageCompleteness =>
  value === "complete" || value === "partial" || value === "unknown";

export function parseChatSpeechUsage(value: unknown): ChatSpeechUsage | null {
  if (!isRecord(value) || !isUuid(value.operationId)) return null;
  if (value.chatId !== null && !isUuid(value.chatId)) return null;
  if (!listed(SPEECH_KINDS, value.kind)) return null;
  if (!listed(SPEECH_UNITS, value.unit)) return null;
  if (!isText(value.model) || value.model.length < 1 || value.model.length > 80) return null;
  if (value.voice !== null && (!isText(value.voice) || value.voice.length > 40)) return null;
  if (value.quantity !== null && !isAmount(value.quantity)) return null;
  if (value.estimatedCostUsd !== null && !isAmount(value.estimatedCostUsd)) return null;
  if (!isProvenance(value.provenance) || !isCompleteness(value.completeness)) return null;
  if (value.provenance === "unknown") {
    if (value.quantity !== null || value.estimatedCostUsd !== null) return null;
    if (value.completeness !== "unknown") return null;
  } else {
    if (value.provenance === "reported" && value.quantity === null) return null;
    if (value.completeness === "unknown") return null;
    if (
      value.completeness === "complete" &&
      (value.quantity === null || value.estimatedCostUsd === null)
    )
      return null;
  }
  return {
    operationId: value.operationId,
    chatId: value.chatId,
    kind: value.kind,
    model: value.model,
    voice: value.voice,
    unit: value.unit,
    quantity: value.quantity,
    estimatedCostUsd: value.estimatedCostUsd,
    provenance: value.provenance,
    completeness: value.completeness,
  };
}

const parseSpeechTotal = (value: unknown): ChatSpeechUsageTotal | null => {
  if (!isRecord(value) || !listed(SPEECH_UNITS, value.unit)) return null;
  if (value.quantity !== null && !isAmount(value.quantity)) return null;
  return { unit: value.unit, quantity: value.quantity };
};

export function parseChatSpeechUsageTotals(value: unknown): ChatSpeechUsageTotals | null {
  if (!isRecord(value) || !isCompleteness(value.completeness)) return null;
  if (value.estimatedCostUsd !== null && !isAmount(value.estimatedCostUsd)) return null;
  if (!Array.isArray(value.units) || value.units.length > SPEECH_UNITS.length) return null;
  const units: ChatSpeechUsageTotal[] = [];
  for (const item of value.units) {
    const total = parseSpeechTotal(item);
    if (!total || units.some((other) => other.unit === total.unit)) return null;
    units.push(total);
  }
  const unknownUnits = units.every((total) => total.quantity === null);
  if (value.completeness === "unknown") {
    if (value.estimatedCostUsd !== null || !unknownUnits) return null;
  } else if (value.completeness === "complete") {
    if (
      value.estimatedCostUsd === null ||
      (units.length === 0 && value.estimatedCostUsd !== 0) ||
      units.some((total) => total.quantity === null)
    )
      return null;
  } else if (unknownUnits && value.estimatedCostUsd === null) {
    return null;
  }
  return { completeness: value.completeness, estimatedCostUsd: value.estimatedCostUsd, units };
}

export type { ChatSpeechKind, ChatSpeechUnit };
