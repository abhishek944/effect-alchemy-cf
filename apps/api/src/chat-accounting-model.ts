/**
 * T27 accounting record shapes, identity rules and category assignment. Pure
 * and storage-free: the store persists these, the amount module prices them,
 * and the aggregate module projects them into the authoritative ChatUsage.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { decodeOption } from "./chat-internal.ts";
import { installedChatCatalog, installedChatModel } from "./chat-capability-catalog.ts";
import {
  type ChatEffort,
  ChatEffort as ChatEffortSchema,
  type ChatModelId,
  ChatModelId as ChatModelIdSchema,
} from "./chat-capabilities.ts";
import type {
  AttemptCategory,
  TokenCounters,
  UsageCompleteness,
  UsageProvenance,
} from "./chat-usage-schema.ts";

/** One bounded page of the durable attempt ledger in the `ChatUsage` response. */
export const ACCOUNTING_RECENT_ATTEMPTS = 100;
/** Registry name of the installed native hook extension. */
export const ACCOUNTING_EXTENSION_NAME = "chat-accounting";

export type AccountingKind = "generation" | "title" | "summarization";

export type AccountingAmount = {
  readonly provenance: UsageProvenance;
  readonly completeness: UsageCompleteness;
  readonly counters: TokenCounters | null;
  readonly estimatedCostUsd: number | null;
};

export type AccountingAttempt = {
  readonly attemptId: string;
  readonly kind: AccountingKind;
  readonly taskId: string | null;
  readonly stopReason: string | null;
  readonly model: ChatModelId | null;
  readonly effort: ChatEffort | null;
  readonly amount: AccountingAmount;
  readonly recordedAt: number;
};

export type NewAccountingAttempt = Omit<AccountingAttempt, "attemptId"> & {
  readonly attemptKey: string;
};

/** Minimal actual title response: amount fields only, never transcript content. */
export type TitleResponse = Pick<
  AssistantMessage,
  "usage" | "stopReason" | "model" | "provider" | "timestamp"
>;

export const emptyCounters = (): TokenCounters => ({
  inputUncached: null,
  inputReported: null,
  output: null,
  cacheRead: null,
  cacheWrite: null,
  reasoning: null,
});

/** Missing provider numbers stay Unknown; zero is never invented. */
export const unknownAmount = (): AccountingAmount => ({
  provenance: "unknown",
  completeness: "unknown",
  counters: null,
  estimatedCostUsd: null,
});

export const modelIdOf = (value: unknown): ChatModelId | null =>
  value === null || value === undefined ? null : decodeOption(ChatModelIdSchema, value);

export const effortOf = (value: unknown): ChatEffort | null =>
  value === null || value === undefined ? null : decodeOption(ChatEffortSchema, value);

/** Maps a native `<provider>/<model>` usage bucket to an installed catalog id. */
export const modelOfBucket = (bucket: string): ChatModelId | null => {
  const direct = modelIdOf(bucket);
  if (direct !== null && installedChatModel(direct) !== null) return direct;
  for (const candidate of installedChatCatalog()) {
    if (bucket === candidate.model || bucket.endsWith(`/${candidate.model}`))
      return candidate.model;
  }
  return direct;
};

export const messageModelId = (message: Pick<AssistantMessage, "model">): ChatModelId | null =>
  modelIdOf(message.model);

export const messageEffort = (
  message: Pick<AssistantMessage, "thinkingLevel">,
): ChatEffort | null => effortOf(message.thinkingLevel);

export const categoryOfAttempt = (
  kind: AccountingKind,
  stopReason: string | null,
  retried: boolean,
): AttemptCategory => {
  if (kind !== "generation") return kind;
  if (stopReason === "aborted") return "aborted";
  if (stopReason === "error") return retried ? "retry" : "failed";
  return "reply";
};
