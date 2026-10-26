import { Schema } from "effect";

export const TOOL_LIMIT = 128;
/** Matches pi-durable 1.1.0 output defaults (not exported by its public API). */
export const TOOL_OUTPUT_BYTES = 50 * 1024;
export const TOOL_OUTPUT_LINES = 2000;
/** Aggregate transport budget, separate from each input/output text limit. */
export const TOOL_PREVIEW_BYTES = 128 * 1024;
const Identity = (max: number) =>
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const Preview = Schema.String.check(Schema.isMaxLength(TOOL_OUTPUT_BYTES));
export const ChatTool = Schema.Struct({
  id: Identity(256),
  name: Identity(128),
  status: Schema.Literals(["pending", "running", "succeeded", "failed", "cancelled", "unknown"]),
  textOffset: Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= 0)),
  input: Preview,
  output: Schema.NullOr(Preview),
  inputTruncated: Schema.Boolean,
  outputTruncated: Schema.Boolean,
});
export type ChatTool = typeof ChatTool.Type;
export const ChatTools = Schema.Array(ChatTool).check(Schema.isMaxLength(TOOL_LIMIT));
