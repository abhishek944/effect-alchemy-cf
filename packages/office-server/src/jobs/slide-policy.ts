import { Predicate, Schema } from "effect";
import { decodeWireSync, OfficeInvalid, safeFailure } from "@starter/office-contract";
import type { NativeInputFrame } from "../ports/jobs.ts";

const Target = Schema.Struct({
  unitId: Schema.String,
  subUnitId: Schema.String,
  drawingId: Schema.String,
});
const Mutation = Schema.Struct({
  unitId: Schema.String,
  subUnitId: Schema.String,
  objects: Schema.Array(Target).check(Schema.isMinLength(1), Schema.isMaxLength(1)),
  op: Schema.Array(Schema.Unknown),
  type: Schema.Literal(2),
  trigger: Schema.optional(Schema.String),
});
const Component = Schema.Struct({
  i: Schema.optional(Schema.Unknown),
  r: Schema.optional(Schema.Unknown),
});
const Path = new Set([
  "color",
  "dataModel",
  "doc",
  "body",
  "dataStream",
  "paragraphs",
  "sectionBreaks",
  "textRuns",
  "customBlocks",
  "customDecorations",
  "customRanges",
  "tables",
  "drawings",
  "drawingsOrder",
  "fontFamily",
  "fontSize",
  "horizontalAlign",
  "isRichText",
  "text",
  "verticalAlign",
]);
const EmptyOnly = new Set(["customBlocks", "customRanges", "tables", "drawings", "drawingsOrder"]);
const deny = () => {
  throw new OfficeInvalid(safeFailure("FORBIDDEN"));
};
const empty = (value: unknown) =>
  value === undefined ||
  (Array.isArray(value) && value.length === 0) ||
  (Predicate.isObject(value) && Object.keys(value).length === 0);

/** Validates a fixed SDK shape-text subtree; SDK JSON1 still owns syntax, semantics and replay. */
export function validateDrawingTextMutation(
  input: NativeInputFrame,
  raw: unknown,
  content: (value: unknown) => void,
): void {
  const p = decodeWireSync(Mutation)(raw),
    target = p.objects[0];
  if (
    !target ||
    p.unitId !== input.binding.unitId ||
    target.unitId !== p.unitId ||
    target.subUnitId !== p.subUnitId
  )
    deny();
  if (!target) return;
  const prefix = [
    p.unitId,
    p.subUnitId,
    "data",
    target.drawingId,
    "element",
    "shapeData",
    "shapeText",
  ];
  if (prefix.some((part, index) => p.op[index] !== part)) deny();
  // Read-only projection: unrelated upstream native fields remain untouched.
  const source = Schema.decodeUnknownSync(
    Schema.Struct({
      slides: Schema.Record(
        Schema.String,
        Schema.Struct({
          elements: Schema.Record(Schema.String, Schema.Struct({ type: Schema.String })),
        }),
      ),
    }),
  )(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(input.native.snapshot.slide?.originalMeta),
    ),
  );
  if (source.slides[p.subUnitId]?.elements[target.drawingId]?.type !== "shape") deny();
  const branches: unknown[] = p.op.slice(prefix.length);
  while (branches.length) {
    const branch = branches.pop();
    if (!Array.isArray(branch)) deny();
    if (!Array.isArray(branch)) return;
    let emptyOnly = false;
    for (const item of branch) {
      if (typeof item === "string") {
        if (!Path.has(item)) deny();
        if (EmptyOnly.has(item)) emptyOnly = true;
      } else if (Array.isArray(item)) {
        const nested: unknown = item;
        branches.push(nested);
      } else {
        const component = decodeWireSync(Component)(item);
        if (emptyOnly && (!empty(component.i) || !empty(component.r))) deny();
        content(component.i);
        content(component.r);
      }
    }
  }
}
