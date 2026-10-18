/**
 * T27 durable row decoding. Full rows are read only for the bounded recent
 * window; lifetime views arrive as SQL aggregates (SUM/COUNT grouped by
 * kind/model or speech unit), so usage reads never load every historical row
 * into JavaScript. Rows hold only amounts, categories and model identity:
 * never transcript text, prompts, context or provider payloads.
 */
import type { AccountingAttempt, AccountingKind } from "./chat-accounting-model.ts";
import { effortOf, modelIdOf } from "./chat-accounting-model.ts";
import { countersFromColumns } from "./chat-accounting-counters.ts";
import {
  SPEECH_UNITS,
  USAGE_COMPLETENESS,
  USAGE_PROVENANCE,
  type SpeechUnit,
  type TokenCounters,
  type UsageCompleteness,
  type UsageProvenance,
} from "./chat-usage-schema.ts";

const isProvenance = (value: string): value is UsageProvenance =>
  USAGE_PROVENANCE.some((item) => item === value);
const isCompleteness = (value: string): value is UsageCompleteness =>
  USAGE_COMPLETENESS.some((item) => item === value);
const isKind = (value: string): value is AccountingKind =>
  value === "generation" || value === "title" || value === "summarization";
const isUnit = (value: string): value is SpeechUnit => SPEECH_UNITS.some((item) => item === value);

/** Lifetime per-model recorded totals from one SQL group. */
export type LifetimeGroup = {
  readonly model: string | null;
  readonly counters: TokenCounters | null;
  readonly costUsd: number | null;
  readonly unknownRows: number;
  readonly knownRows: number;
  readonly missingCost: boolean;
};

/** Lifetime per-unit speech totals from one SQL group. */
export type SpeechGroup = {
  readonly unit: SpeechUnit;
  readonly quantity: number | null;
  readonly estimatedCostUsd: number | null;
  readonly rows: number;
  readonly unknownRows: number;
  readonly completeRows: number;
  readonly costRows: number;
};

/** One bounded recent attempt plus its generation-retry classification. */
export type RecentAttempt = { readonly attempt: AccountingAttempt; readonly retried: boolean };

export type AttemptGroupRow = {
  model: string | null;
  uncached: number | null;
  output: number | null;
  cache_read: number | null;
  cache_write: number | null;
  reasoning: number | null;
  cost: number | null;
  rows: number;
  unknown_rows: number;
  known_rows: number;
  missing_cost_rows: number;
};

export type SpeechGroupRow = {
  unit: string;
  quantity: number | null;
  cost: number | null;
  rows: number;
  unknown_rows: number;
  complete_rows: number;
  missing_cost_rows: number;
};

export type AttemptRow = {
  rowid: number;
  attempt_id: string;
  kind: string;
  task_id: string | null;
  stop_reason: string | null;
  model: string | null;
  effort: string | null;
  tokens_uncached: number | null;
  tokens_output: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  tokens_reasoning: number | null;
  estimated_cost_usd: number | null;
  provenance: string;
  completeness: string;
  recorded_at: number;
};

/** Full attempt columns in `AttemptRow` order, without the leading rowid. */
export const ATTEMPT_COLUMNS = `attempt_id, kind, task_id, stop_reason, model, effort,
  tokens_uncached, tokens_output, tokens_cache_read, tokens_cache_write, tokens_reasoning,
  estimated_cost_usd, provenance, completeness, recorded_at`;

/** Aggregate expression list shared by the attempt and title group queries. */
export const ATTEMPT_GROUP_COLUMNS = `model,
  SUM(tokens_uncached) AS uncached, SUM(tokens_output) AS output,
  SUM(tokens_cache_read) AS cache_read, SUM(tokens_cache_write) AS cache_write,
  SUM(tokens_reasoning) AS reasoning, SUM(estimated_cost_usd) AS cost,
  COUNT(*) AS rows,
  SUM(CASE WHEN completeness = 'unknown' THEN 1 ELSE 0 END) AS unknown_rows,
  SUM(CASE WHEN completeness != 'unknown' THEN 1 ELSE 0 END) AS known_rows,
  SUM(CASE WHEN completeness != 'unknown' AND estimated_cost_usd IS NULL THEN 1 ELSE 0 END)
    AS missing_cost_rows`;

export const lifetimeGroup = (row: AttemptGroupRow): LifetimeGroup => ({
  model: row.model,
  counters: countersFromColumns(
    row.uncached,
    row.output,
    row.cache_read,
    row.cache_write,
    row.reasoning,
  ),
  costUsd: row.cost,
  unknownRows: row.unknown_rows,
  knownRows: row.known_rows,
  missingCost: row.missing_cost_rows > 0,
});

export const speechGroup = (row: SpeechGroupRow): SpeechGroup | null =>
  isUnit(row.unit)
    ? {
        unit: row.unit,
        quantity: row.quantity,
        estimatedCostUsd: row.cost,
        rows: row.rows,
        unknownRows: row.unknown_rows,
        completeRows: row.complete_rows,
        costRows: row.rows - row.missing_cost_rows,
      }
    : null;

export const attemptRow = (row: AttemptRow): AccountingAttempt | null => {
  if (!isKind(row.kind) || !isProvenance(row.provenance) || !isCompleteness(row.completeness))
    return null;
  return {
    attemptId: row.attempt_id,
    kind: row.kind,
    taskId: row.task_id,
    stopReason: row.stop_reason,
    model: modelIdOf(row.model),
    effort: effortOf(row.effort),
    amount: {
      provenance: row.provenance,
      completeness: row.completeness,
      counters: countersFromColumns(
        row.tokens_uncached,
        row.tokens_output,
        row.tokens_cache_read,
        row.tokens_cache_write,
        row.tokens_reasoning,
      ),
      estimatedCostUsd: row.estimated_cost_usd,
    },
    recordedAt: row.recorded_at,
  };
};
