import { Schema } from "effect";
import { Call } from "./blocks.ts";
import { Assistant } from "./messages.ts";

const Partial = Schema.Struct({ partial: Assistant });

/**
 * One normalized provider stream event, as the SDK's `AssistantMessageEvent`
 * declares it. The Worker re-emits its own pi-ai stream in this shape and the
 * host forwards each event into the stream the SDK is consuming.
 */
export const AssistantMessageEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("start"), ...Partial.fields }),
  Schema.Struct({
    type: Schema.Literal("text_start"),
    contentIndex: Schema.Number,
    ...Partial.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("text_delta"),
    contentIndex: Schema.Number,
    delta: Schema.String,
    ...Partial.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("text_end"),
    contentIndex: Schema.Number,
    content: Schema.String,
    ...Partial.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("thinking_start"),
    contentIndex: Schema.Number,
    ...Partial.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("thinking_delta"),
    contentIndex: Schema.Number,
    delta: Schema.String,
    ...Partial.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("thinking_end"),
    contentIndex: Schema.Number,
    content: Schema.String,
    ...Partial.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("toolcall_start"),
    contentIndex: Schema.Number,
    ...Partial.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("toolcall_delta"),
    contentIndex: Schema.Number,
    delta: Schema.String,
    ...Partial.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("toolcall_end"),
    contentIndex: Schema.Number,
    toolCall: Call,
    ...Partial.fields,
  }),
  Schema.Struct({
    type: Schema.Literal("done"),
    reason: Schema.Literals(["stop", "length", "toolUse", "deferred"]),
    message: Assistant,
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    reason: Schema.Literals(["aborted", "error"]),
    error: Assistant,
  }),
]);
export type AssistantMessageEvent = typeof AssistantMessageEvent.Type;

export const isTerminalEvent = (
  event: AssistantMessageEvent,
): event is Extract<AssistantMessageEvent, { type: "done" | "error" }> =>
  event.type === "done" || event.type === "error";
