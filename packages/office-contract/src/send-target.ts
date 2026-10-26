import { Schema } from "effect";
import { Count, Id, Kind, Revision, decodeWireSync } from "./primitives.ts";

/** Bounded context sizes; the frame uses the same cap so one native selection fits the wire. */
export const MAX_OFFICE_SEND_RANGES = 8;
export const MAX_OFFICE_SEND_ATTACHMENTS = 8;
/** Native worksheet/range identity: opaque in the document, not a task or read/write reference. */
const SheetId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(96),
  Schema.isPattern(/^[A-Za-z0-9_.:-]+$/),
);
const SheetName = Schema.String.check(Schema.isMaxLength(120));
const A1Notation = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(96));
/**
 * Actual native selection coordinates: 0-based rows/columns with the inclusive end bounds the
 * Univer Facade reports (a single cell has equal start and end), so no selected cell is shifted.
 */
export const OfficeSheetRange = Schema.Struct({
  startRow: Count,
  startColumn: Count,
  endRow: Count,
  endColumn: Count,
  /** Native bounded designation such as A5:C5; coordinates stay authoritative. */
  a1: Schema.optionalKey(A1Notation),
});
export type OfficeSheetRange = typeof OfficeSheetRange.Type;
export const OfficeSheetSelection = Schema.Struct({
  sheetId: SheetId,
  sheetName: Schema.optionalKey(SheetName),
  ranges: Schema.Array(OfficeSheetRange).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_OFFICE_SEND_RANGES),
  ),
});
export type OfficeSheetSelection = typeof OfficeSheetSelection.Type;
/**
 * Descriptive Send context: known opened attachment identities and the worksheet/range the
 * editor actually showed. It is not a task, view or authorization authority, and a server
 * that receives it must still resolve the requested attachment and native target itself.
 */
export const OfficeSendContext = Schema.Struct({
  attachmentIds: Schema.optionalKey(
    Schema.Array(Id).check(Schema.isMaxLength(MAX_OFFICE_SEND_ATTACHMENTS)),
  ),
  sheet: Schema.optionalKey(OfficeSheetSelection),
});
export type OfficeSendContext = typeof OfficeSendContext.Type;

const Common = {
  viewId: Id,
  documentId: Id,
  documentKind: Kind,
  expectedRevision: Revision,
  /** Optional so accepted inputs written before Send context existed keep decoding unchanged. */
  context: Schema.optionalKey(OfficeSendContext),
};
/** Frozen displayed selection only. View IDs and revisions are NOT task/native authority. */
export const OfficeSendTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("main"), ...Common }),
  Schema.Struct({
    kind: Schema.Literal("draft"),
    ...Common,
    draftId: Id,
    generation: Count,
  }),
]);
export type OfficeSendTarget = typeof OfficeSendTarget.Type;

const freezeSheet = (sheet: OfficeSheetSelection): OfficeSheetSelection =>
  Object.freeze({
    ...sheet,
    ranges: Object.freeze(sheet.ranges.map((range) => Object.freeze({ ...range }))),
  });
const freezeContext = (context: OfficeSendContext): OfficeSendContext =>
  Object.freeze({
    ...(context.attachmentIds === undefined
      ? {}
      : { attachmentIds: Object.freeze([...context.attachmentIds]) }),
    ...(context.sheet === undefined ? {} : { sheet: freezeSheet(context.sheet) }),
  });
/** Scalar DTO: clone/validate before any await or upload; never retain a mutable pane object. */
export const freezeOfficeSendTarget = (input: OfficeSendTarget): OfficeSendTarget => {
  const target = decodeWireSync(OfficeSendTarget)(input);
  const frozen = Object.freeze(target);
  return frozen.context === undefined
    ? frozen
    : Object.freeze({ ...frozen, context: freezeContext(frozen.context) });
};

const contextIdentity = (context: OfficeSendContext): readonly unknown[] => [
  context.attachmentIds ?? [],
  ...(context.sheet === undefined
    ? []
    : [
        context.sheet.sheetId,
        context.sheet.sheetName ?? null,
        ...context.sheet.ranges.map((range) => [
          range.startRow,
          range.startColumn,
          range.endRow,
          range.endColumn,
          range.a1 ?? null,
        ]),
      ]),
];
/** Deterministic intent correlation, independent of incoming object property order. */
export const officeSendTargetIdentity = (target: OfficeSendTarget): readonly unknown[] => [
  "office-send-target",
  1,
  target.kind,
  target.viewId,
  target.documentId,
  target.documentKind,
  target.expectedRevision,
  ...(target.kind === "draft" ? [target.draftId, target.generation] : []),
  // Appended only when present: accepted inputs without context keep their exact old identity.
  ...(target.context === undefined ? [] : ["office-send-context", contextIdentity(target.context)]),
];
