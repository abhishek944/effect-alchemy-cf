import { Schema } from "effect";
import { ArtifactRef } from "./models.ts";
import { DraftTarget, Id } from "./primitives.ts";
import { ImportOptions } from "./requests.ts";

export const SheetImportOptions = Schema.Union([
  ImportOptions.members[0],
  ImportOptions.members[1],
]);
const Name = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isPattern(/^[^\uD800-\uDFFF]+$/u),
);
/** Structural append only; neither upload nor an accepted reference creates a document. */
export const ImportInto = Schema.Struct({
  operationId: Id,
  target: DraftTarget,
  source: Schema.Struct({
    ...ArtifactRef.fields,
    kind: Schema.Literal("upload"),
    bytes: ArtifactRef.fields.bytes.check(Schema.isLessThanOrEqualTo(10 * 1024 * 1024)),
  }),
  options: SheetImportOptions,
  selection: Schema.Struct({
    destinationNames: Schema.Array(
      Schema.Struct({ sourceName: Name, destinationName: Name }),
    ).check(
      Schema.isMaxLength(32),
      Schema.makeFilter(
        (items) =>
          new Set(items.map((item) => item.sourceName)).size === items.length &&
          new Set(items.map((item) => item.destinationName.toLowerCase())).size === items.length,
      ),
    ),
    sheets: Schema.Union([
      Schema.Literal("all"),
      Schema.Array(Name).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(32),
        Schema.makeFilter((names) => new Set(names).size === names.length),
      ),
    ]),
  }),
  insertion: Schema.Literal("append"),
  collision: Schema.Literal("reject"),
});
export type ImportInto = typeof ImportInto.Type;
