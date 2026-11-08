import { Schema } from "effect";
import {
  AssistantBlock,
  DeferredHandle,
  Diagnostic,
  StopReason,
  Text,
  ToolResultBlock,
  Usage,
  UserBlock,
} from "./blocks.ts";

export const ToolReference = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
});
export type ToolReference = typeof ToolReference.Type;

const isJsonObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A JSON Schema document for tool parameters, validated as a plain object. Its type
 * is `object`, which is assignable both to and from the SDK's TypeBox `TSchema`.
 */
export const JsonSchemaDocument = Schema.declare<object>(isJsonObject);
export type JsonSchemaDocument = typeof JsonSchemaDocument.Type;

/**
 * A tool declaration in a restored system message. It is the SDK's own `Tool`
 * shape, which carries no display label.
 */
export const WireTool = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  description: Schema.String,
  parameters: JsonSchemaDocument,
});
export type WireTool = typeof WireTool.Type;

/**
 * A tool the Worker asks the host to register for this run. `parameters` is a JSON
 * Schema document; the SDK validates tool arguments with it.
 */
export const ToolDeclaration = Schema.Struct({
  ...WireTool.fields,
  label: Schema.String.check(Schema.isMinLength(1)),
});
export type ToolDeclaration = typeof ToolDeclaration.Type;

export const System = Schema.Struct({
  role: Schema.Literal("system"),
  content: Schema.Union([Schema.String, Schema.mutable(Schema.Array(Text))]),
  sections: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Null])),
  ),
  toolsAdded: Schema.optionalKey(Schema.mutable(Schema.Array(WireTool))),
  toolsRemoved: Schema.optionalKey(Schema.mutable(Schema.Array(ToolReference))),
  timestamp: Schema.Number,
});
export type System = typeof System.Type;

export const User = Schema.Struct({
  role: Schema.Literal("user"),
  content: Schema.Union([Schema.String, Schema.mutable(Schema.Array(UserBlock))]),
  timestamp: Schema.Number,
});
export type User = typeof User.Type;

export const Assistant = Schema.Struct({
  role: Schema.Literal("assistant"),
  content: Schema.mutable(Schema.Array(AssistantBlock)),
  api: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  responseModel: Schema.optionalKey(Schema.String),
  responseId: Schema.optionalKey(Schema.String),
  providerThinkingLevel: Schema.optionalKey(Schema.String),
  thinkingLevel: Schema.optionalKey(
    Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
  ),
  diagnostics: Schema.optionalKey(Schema.mutable(Schema.Array(Diagnostic))),
  usage: Usage,
  stopReason: StopReason,
  deferred: Schema.optionalKey(DeferredHandle),
  errorMessage: Schema.optionalKey(Schema.String),
  rawStopReason: Schema.optionalKey(Schema.String),
  endTurn: Schema.optionalKey(Schema.Boolean),
  timestamp: Schema.Number,
  durationMs: Schema.optionalKey(Schema.Number),
});
export type Assistant = typeof Assistant.Type;
/** The SDK's name for the same value. */
export type AssistantMessage = Assistant;

const NestedCall = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  arguments: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  argumentsBytes: Schema.optionalKey(Schema.Number),
  status: Schema.Literals(["ok", "error", "unfinished"]),
  durationMs: Schema.optionalKey(Schema.Number),
  error: Schema.optionalKey(Schema.String),
});
const NestedCalls = Schema.Struct({
  calls: Schema.mutable(Schema.Array(NestedCall)),
  complete: Schema.Boolean,
});

export const ToolResult = Schema.Struct({
  role: Schema.Literal("toolResult"),
  toolCallId: Schema.String.check(Schema.isMinLength(1)),
  toolName: Schema.String.check(Schema.isMinLength(1)),
  content: Schema.mutable(Schema.Array(ToolResultBlock)),
  details: Schema.optionalKey(Schema.Json),
  usage: Schema.optionalKey(Usage),
  nestedCalls: Schema.optionalKey(NestedCalls),
  isError: Schema.Boolean,
  timestamp: Schema.Number,
  durationMs: Schema.optionalKey(Schema.Number),
});
export type ToolResult = typeof ToolResult.Type;

/** Every finalized message shape a chat transcript can hold. */
export const Message = Schema.Union([System, User, Assistant, ToolResult]);
export type Message = typeof Message.Type;

/**
 * The transcript handed to a provider turn. Prompts and tool declarations travel
 * inside system messages, so the messages alone reconstruct the request.
 */
export const Context = Schema.Struct({ messages: Schema.mutable(Schema.Array(Message)) });
export type Context = typeof Context.Type;
