import { Schema } from "effect";

export const TOOL_LIMIT = 128;
export const TOOL_PREVIEW_UNITS = 2048;
export const TOOL_PREVIEW_BYTES = 8192;
const Identity = (max: number) =>
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const Preview = Schema.String.check(Schema.isMaxLength(8192));
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
