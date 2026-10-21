import { Schema } from "effect";
import { readPiece, readValue } from "./ref-shapes.ts";
import { readMergeResult } from "./record-shapes.ts";
import { NativeName, NativeType, Natural, parseMetadata } from "./metadata-parse.ts";

const DraftRow = Schema.Struct({
  type: NativeType,
  source: Schema.Literals(["trunk", "worktree"]),
  baseline: Schema.NullOr(Natural),
  head: Natural,
  ready: Schema.NullOr(Natural),
  creator: NativeName,
  created: Natural,
  removed: Schema.Literals([0, 1]),
  merge_result: Schema.NullOr(Schema.String.check(Schema.isMaxLength(16384))),
  seed: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
  artifact: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
  artifact_ready: Schema.NullOr(Natural),
});
const json = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
export const readPieceJSON = (input: string) => readPiece(json(input));
export const readValueJSON = (input: string) => readValue(json(input));
export const readMergeResultJSON = (input: string) => readMergeResult(json(input));
export const readDraftJSON = (input: string) => parseMetadata(DraftRow, json(input));
