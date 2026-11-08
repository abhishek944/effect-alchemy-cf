import { Schema } from "effect";
import { ToolResultBlock } from "./blocks.ts";

/** Reply kind decides the body encoding the host accepts for that request id. */
export const ReplyKind = Schema.Literals(["tool", "model"]);
export type ReplyKind = typeof ReplyKind.Type;

/**
 * Result of one Worker-owned tool call. The host maps it onto the SDK's
 * `AgentToolResult`, so `details` stays JSON and `isError` reports a tool
 * failure without throwing.
 */
export const ToolReply = Schema.Struct({
  content: Schema.mutable(Schema.Array(ToolResultBlock)),
  details: Schema.optionalKey(Schema.Json),
  isError: Schema.optionalKey(Schema.Boolean),
});
export type ToolReply = typeof ToolReply.Type;

/** Body returned for an accepted reply. */
export const ReplyAccepted = Schema.Struct({ accepted: Schema.Literal(true) });
export type ReplyAccepted = typeof ReplyAccepted.Type;

/** Body returned for a stop request; `stopped` is true only for that exact live run. */
export const StopResult = Schema.Struct({
  runId: Schema.String,
  stopped: Schema.Boolean,
});
export type StopResult = typeof StopResult.Type;

export const Health = Schema.Struct({ ok: Schema.Literal(true) });
export type Health = typeof Health.Type;
