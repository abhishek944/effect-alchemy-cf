import { Schema } from "effect";
import { Assistant } from "./messages.ts";
import { Context, Message } from "./messages.ts";
import { ModelDescriptor, WireId } from "./run-request.ts";

/** Streaming assistant state, emitted for each SDK `message_update`. */
export const PartialEvent = Schema.Struct({
  type: Schema.Literal("partial"),
  message: Assistant,
});
export type PartialEvent = typeof PartialEvent.Type;

/** One finalized message, emitted for each SDK `message_end`. */
export const MessageEvent = Schema.Struct({
  type: Schema.Literal("message"),
  message: Message,
});
export type MessageEvent = typeof MessageEvent.Type;

/** Run one Worker-owned tool; the reply arrives on the tool reply channel. */
export const ToolRequestEvent = Schema.Struct({
  type: Schema.Literal("tool"),
  requestId: WireId,
  toolCallId: Schema.String.check(Schema.isMinLength(1)),
  toolName: Schema.String.check(Schema.isMinLength(1)),
  input: Schema.Unknown,
});
export type ToolRequestEvent = typeof ToolRequestEvent.Type;

/**
 * Why the SDK is calling the model. `compaction` reports the SDK's own summarization
 * turn so the Worker can account for it separately from generation.
 */
/** Provider reasoning level in the pi-ai sense: `off` is expressed by omission. */
export const ProviderThinkingLevel = Schema.Literals([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ProviderThinkingLevel = typeof ProviderThinkingLevel.Type;

export const ModelRequestKind = Schema.Literals(["generation", "compaction"]);
export type ModelRequestKind = typeof ModelRequestKind.Type;

/** Perform one provider turn; the normalized stream arrives on the model reply channel. */
export const ModelRequestEvent = Schema.Struct({
  type: Schema.Literal("model"),
  requestId: WireId,
  kind: ModelRequestKind,
  model: ModelDescriptor,
  context: Context,
  options: Schema.Struct({
    reasoning: Schema.optionalKey(ProviderThinkingLevel),
    /** Output allowance the SDK set for this turn, such as a summarization budget. */
    maxTokens: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
  }),
});
export type ModelRequestEvent = typeof ModelRequestEvent.Type;

export const SettledStatus = Schema.Literals(["answered", "unanswered", "stopped"]);
export type SettledStatus = typeof SettledStatus.Type;

/** Terminal run event; exactly one closes every run stream. */
export const SettledEvent = Schema.Struct({
  type: Schema.Literal("settled"),
  status: SettledStatus,
  error: Schema.optionalKey(Schema.String),
});
export type SettledEvent = typeof SettledEvent.Type;

export const RunEvent = Schema.Union([
  PartialEvent,
  MessageEvent,
  ToolRequestEvent,
  ModelRequestEvent,
  SettledEvent,
]);
export type RunEvent = typeof RunEvent.Type;

export const isSettledEvent = (event: RunEvent): event is SettledEvent => event.type === "settled";
