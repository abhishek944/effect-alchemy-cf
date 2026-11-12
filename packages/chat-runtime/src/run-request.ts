import { Schema } from "effect";
import { Image } from "./blocks.ts";
import { Message, ToolDeclaration } from "./messages.ts";

/**
 * Provider thinking level, as the SDK's own `ThinkingLevel` names it. `off` is a
 * real level here; it must reach the SDK as `off` rather than as a missing value
 * that would silently restore a default budget.
 */
export const RunEffort = Schema.Literals([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type RunEffort = typeof RunEffort.Type;

/** Path-safe opaque identifier issued by the caller (run) or the host (request). */
export const WireId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isPattern(/^[A-Za-z0-9_.:-]+$/),
);
export type WireId = typeof WireId.Type;

/** Configured model selection the Worker resolved for this operation. */
export const RunSelection = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
  effort: RunEffort,
});
export type RunSelection = typeof RunSelection.Type;

const ModelCost = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
});

/**
 * Capacity and reasoning metadata of the catalog model the Worker actually
 * selected. The host builds the SDK model from these trusted values instead of
 * inventing static limits of its own.
 */
export const ModelDescriptor = Schema.Struct({
  contextWindow: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  maxTokens: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  reasoning: Schema.Boolean,
  input: Schema.mutable(Schema.Array(Schema.Literals(["text", "image"]))).check(
    Schema.isMinLength(1),
  ),
  cost: ModelCost,
  thinkingLevelMap: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Null])),
  ),
});
export type ModelDescriptor = typeof ModelDescriptor.Type;

/**
 * Everything the host needs to execute one accepted operation.
 *
 * `history` is the finalized transcript the SDK must restore. It stays compact for
 * newly accepted rows, but image blocks that a valid historical transcript already
 * carries are passed through untouched: the host never hydrates or rewrites history.
 * `images` holds only this prompt's hydrated originals, which the host keeps in
 * memory for the run.
 */
export const RunRequest = Schema.Struct({
  runId: WireId,
  tracing: Schema.Struct({
    userId: Schema.String.check(Schema.isMinLength(1)),
    sessionId: WireId,
  }),
  selection: RunSelection,
  model: ModelDescriptor,
  history: Schema.mutable(Schema.Array(Message)),
  prompt: Schema.String.check(Schema.isMinLength(1)),
  images: Schema.mutable(Schema.Array(Image)),
  tools: Schema.mutable(Schema.Array(ToolDeclaration)),
  systemPrompt: Schema.String,
});
export type RunRequest = typeof RunRequest.Type;
