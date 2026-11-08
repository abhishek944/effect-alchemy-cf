import { Schema } from "effect";

/**
 * Content, usage and stop-reason values exactly as `@earendil-works/pi-ai` 1.1.0
 * declares them. Both sides of the wire pin that version, so a decoded value stays
 * assignable to the SDK's own types with no cast. Arrays are decoded mutable because
 * the SDK's message types use mutable arrays.
 */
export const Json = Schema.Json;
export const JsonObject = Schema.Record(Schema.String, Json);

export const Text = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  textSignature: Schema.optionalKey(Schema.String),
});
export type Text = typeof Text.Type;

export const Thinking = Schema.Struct({
  type: Schema.Literal("thinking"),
  thinking: Schema.String,
  thinkingSignature: Schema.optionalKey(Schema.String),
  redacted: Schema.optionalKey(Schema.Boolean),
});
export type Thinking = typeof Thinking.Type;

export const Image = Schema.Struct({
  type: Schema.Literal("image"),
  data: Schema.String,
  mimeType: Schema.String.check(Schema.isMinLength(1)),
});
export type Image = typeof Image.Type;

export const Call = Schema.Struct({
  type: Schema.Literal("toolCall"),
  id: Schema.String.check(Schema.isMinLength(1)),
  name: Schema.String.check(Schema.isMinLength(1)),
  arguments: JsonObject,
  thoughtSignature: Schema.optionalKey(Schema.String),
  namespace: Schema.optionalKey(Schema.String),
});
export type Call = typeof Call.Type;

const Cost = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  total: Schema.Number,
});

export const Usage = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  cacheWrite1h: Schema.optionalKey(Schema.Number),
  reasoning: Schema.optionalKey(Schema.Number),
  totalTokens: Schema.Number,
  cost: Cost,
});
export type Usage = typeof Usage.Type;

export const StopReason = Schema.Literals([
  "pending",
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
  "deferred",
]);
export type StopReason = typeof StopReason.Type;

/** Blocks a user turn may carry. */
export const UserBlock = Schema.Union([Text, Image]);
export type UserBlock = typeof UserBlock.Type;

/** Blocks an assistant turn may carry; signatures must survive the round trip. */
export const AssistantBlock = Schema.Union([Text, Thinking, Call]);
export type AssistantBlock = typeof AssistantBlock.Type;

/** Blocks a tool result may carry. */
export const ToolResultBlock = Schema.Union([Text, Image]);
export type ToolResultBlock = typeof ToolResultBlock.Type;

export const DeferredHandle = Schema.Struct({
  provider: Schema.String,
  modelId: Schema.String,
  api: Schema.String,
  id: Schema.String,
  expiresAt: Schema.optionalKey(Schema.Number),
  pollAfterMs: Schema.optionalKey(Schema.Number),
  data: Schema.optionalKey(Json),
});
export type DeferredHandle = typeof DeferredHandle.Type;

export const DiagnosticError = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  message: Schema.String,
  stack: Schema.optionalKey(Schema.String),
  code: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
});

/** Provider bookkeeping that must be preserved without being interpreted here. */
export const Diagnostic = Schema.Struct({
  type: Schema.String,
  timestamp: Schema.Number,
  error: Schema.optionalKey(DiagnosticError),
  details: Schema.optionalKey(JsonObject),
});
export type Diagnostic = typeof Diagnostic.Type;
