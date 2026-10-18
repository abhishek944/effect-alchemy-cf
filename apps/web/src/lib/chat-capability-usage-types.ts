/**
 * Browser projection of reported and estimated usage accounting.
 *
 * A missing counter is null, never zero. `inputUncached` is the normalized
 * uncached input and cost basis; `inputReported` is the provider total that
 * includes cache read and write, so a response-details view can show
 * "input N (cached M)" without double counting. `reasoning` is a subset of
 * `output`. Speech keeps real billing units, separate from context tokens.
 */
import type { ChatEffort } from "@/lib/chat-capability-types";

export type ChatUsageProvenance = "reported" | "estimated" | "unknown";
export type ChatUsageCompleteness = "complete" | "partial" | "unknown";

export const USAGE_PROVENANCE: readonly ChatUsageProvenance[] = [
  "reported",
  "estimated",
  "unknown",
];
export const USAGE_COMPLETENESS: readonly ChatUsageCompleteness[] = [
  "complete",
  "partial",
  "unknown",
];

export type ChatTokenCounters = {
  inputUncached: number | null;
  inputReported: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  reasoning: number | null;
};

export type ChatUsageAmount = {
  provenance: ChatUsageProvenance;
  completeness: ChatUsageCompleteness;
  tokens: ChatTokenCounters;
  /** Catalog-price estimate in US dollars; never an invoice. */
  estimatedCostUsd: number | null;
};

export type ChatContextUsage = {
  provenance: "estimated" | "unknown";
  /** Selection whose catalog limit applies, or null when unknown. */
  model: string | null;
  estimatedTokens: number | null;
  contextWindow: number | null;
};

export type ChatAttemptCategory =
  | "reply"
  | "retry"
  | "failed"
  | "aborted"
  | "summarization"
  | "title";

export const ATTEMPT_CATEGORIES: readonly ChatAttemptCategory[] = [
  "reply",
  "retry",
  "failed",
  "aborted",
  "summarization",
  "title",
];

export type ChatAttemptUsage = {
  attemptId: string;
  category: ChatAttemptCategory;
  model: string;
  effort: ChatEffort;
  amount: ChatUsageAmount;
};

export type ChatSpeechUnit = "audio_seconds" | "characters" | "tokens";
export type ChatSpeechKind = "transcription" | "synthesis";

export const SPEECH_UNITS: readonly ChatSpeechUnit[] = ["audio_seconds", "characters", "tokens"];
export const SPEECH_KINDS: readonly ChatSpeechKind[] = ["transcription", "synthesis"];

export type ChatSpeechUsage = {
  operationId: string;
  chatId: string | null;
  kind: ChatSpeechKind;
  model: string;
  voice: string | null;
  unit: ChatSpeechUnit;
  /** Null means the real quantity is unknown, never zero. */
  quantity: number | null;
  estimatedCostUsd: number | null;
  provenance: ChatUsageProvenance;
  completeness: ChatUsageCompleteness;
};

export type ChatSpeechUsageTotal = { unit: ChatSpeechUnit; quantity: number | null };

export type ChatSpeechUsageTotals = {
  completeness: ChatUsageCompleteness;
  estimatedCostUsd: number | null;
  units: ChatSpeechUsageTotal[];
};

export const MAX_USAGE_ATTEMPTS = 200;

export type ChatUsage = {
  completeness: ChatUsageCompleteness;
  amount: ChatUsageAmount;
  context: ChatContextUsage;
  attempts: ChatAttemptUsage[];
  speech: ChatSpeechUsageTotals;
};
