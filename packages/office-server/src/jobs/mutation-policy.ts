import { Predicate, Schema } from "effect";
import { decodeWireSync, OfficeInvalid, safeFailure } from "@starter/office-contract";
import { NATIVE_WIRE_LIMITS, encodeNativeFrame } from "@starter/office-contract/native-wire";
import type { IMutation } from "@univerjs/protocol";
import type { NativeInputFrame } from "../ports/jobs.ts";
import { validateDrawingTextMutation } from "./slide-policy.ts";

const Id = Schema.String;
const optional = Schema.optional;
const Cell = Schema.Struct({
  v: optional(
    Schema.Union([
      Schema.Null,
      Schema.String,
      Schema.Boolean,
      Schema.Number.check(Schema.isFinite()),
    ]),
  ),
  t: optional(Schema.Number),
  f: optional(Schema.NullOr(Schema.String)),
  p: optional(Schema.Null),
  ft: optional(Schema.NullOr(Schema.Number)),
  fd: optional(Schema.NullOr(Schema.Number)),
  si: optional(Schema.String),
  s: optional(Schema.Union([Schema.String, Schema.Null])),
});
const Index = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,5})$/));
const common = {
  unitId: Id,
  trigger: optional(Schema.String),
  __splitChunk__: optional(Schema.Boolean),
};
const Sheet = Schema.Struct({
  ...common,
  subUnitId: Id,
  isOverrideStyle: optional(Schema.Boolean),
  styleRefMap: optional(Schema.Struct({})),
  cellValue: optional(Schema.Record(Index, Schema.Record(Index, Schema.NullOr(Cell)))),
});
const Document = Schema.Struct({
  ...common,
  actions: Schema.Array(Schema.Unknown),
  textRanges: Schema.Unknown,
  segmentId: optional(Id),
  prevTextRanges: optional(Schema.Unknown),
  noNeedSetTextRange: optional(Schema.Boolean),
  isCompositionEnd: optional(Schema.Boolean),
  noHistory: optional(Schema.Boolean),
  debounce: optional(Schema.Boolean),
  options: optional(Schema.Record(Schema.String, Schema.Boolean)),
  isSync: optional(Schema.Boolean),
  isEditing: optional(Schema.Boolean),
  syncer: optional(Schema.String),
});
const Slide = Schema.Struct({
  unitId: Id,
  subUnitId: Id,
  drawingId: optional(Id),
  element: Schema.Record(Schema.String, Schema.Unknown),
  transform: optional(Schema.Unknown),
  isRealtimePreview: optional(Schema.Boolean),
  formulaLastValueGuard: optional(Schema.Unknown),
  nameBase: optional(Schema.String),
  sourcePageType: optional(Schema.String),
  insertIndex: optional(Schema.Number),
});
const object = Schema.Record(Schema.String, Schema.Unknown);
const deny = () => {
  throw new OfficeInvalid(safeFailure("FORBIDDEN"));
};
export function noExternalGraphics(value: unknown): void {
  const stack = [value];
  while (stack.length) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      for (const child of item) {
        const nested: unknown = child;
        stack.push(nested);
      }
      continue;
    }
    if (!Predicate.isObject(item)) continue;
    for (const [key, child] of Object.entries(item)) {
      if (["source", "imageSourceType", "formula"].includes(key)) deny();
      if (["customBlocks", "drawings", "customRanges"].includes(key)) {
        if (Array.isArray(child) && child.length === 0) continue;
        if (Predicate.isObject(child) && Object.keys(child).length === 0) continue;
        deny();
      }
      if (key === "resources" && (!Array.isArray(child) || child.length !== 0)) deny();
      stack.push(child);
    }
  }
}
/** Verified initial content profile; lifecycle/ACL/media/reference mutations fail explicitly. */
export function validateContentMutation(input: NativeInputFrame, mutation: IMutation): void {
  const params = decodeWireSync(object)(JSON.parse(mutation.data));
  encodeNativeFrame("job-output", params, {
    ...NATIVE_WIRE_LIMITS,
    maxBytes: 2 * 1024 * 1024,
    maxDepth: 32,
    maxNodes: 100_000,
  });
  if (params.unitId !== input.binding.unitId) deny();
  if (input.binding.kind === "slide" && mutation.id === "slide.mutation.set-drawing-apply") {
    validateDrawingTextMutation(input, params, noExternalGraphics);
    return;
  }
  if (input.binding.kind === "sheet" && mutation.id === "sheet.mutation.set-range-values") {
    const p = decodeWireSync(Sheet)(params),
      sheet = input.native.snapshot.workbook?.sheets[p.subUnitId];
    if (!sheet) deny();
    for (const [row, cells] of Object.entries(p.cellValue ?? {})) {
      if (!sheet || Number(row) >= sheet.rowCount) deny();
      for (const column of Object.keys(cells))
        if (!sheet || Number(column) >= sheet.columnCount) deny();
    }
    return;
  }
  if (input.binding.kind === "doc" && mutation.id === "doc.mutation.rich-text-editing") {
    const p = decodeWireSync(Document)(params);
    if (p.actions[0] !== "body" || p.actions.length !== 2 || !Predicate.isObject(p.actions[1]))
      deny();
    noExternalGraphics(p.actions);
    return;
  }
  if (
    input.binding.kind === "slide" &&
    ["slide.mutation.update-slide-element", "slide.mutation.add-slide-element"].includes(
      mutation.id,
    )
  ) {
    const p = decodeWireSync(Slide)(params);
    if (p.element.type !== "shape" && p.element.type !== "text") deny();
    if (p.drawingId !== undefined && p.drawingId !== p.element.id) deny();
    const data = Schema.decodeUnknownSync(
      Schema.Struct({ slides: Schema.Record(Schema.String, Schema.Unknown) }),
    )(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(input.native.snapshot.slide?.originalMeta),
      ),
    );
    if (!Object.hasOwn(data.slides, p.subUnitId)) deny();
    noExternalGraphics(p.element);
    return;
  }
  deny();
}
