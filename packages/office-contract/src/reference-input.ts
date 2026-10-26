import { Schema } from "effect";
import { Count, Id, decodeWireSync } from "./primitives.ts";
import {
  MAX_OFFICE_SEND_ATTACHMENTS,
  OfficeSendTarget,
  OfficeSheetSelection,
  freezeOfficeSendTarget,
  officeSendTargetIdentity,
} from "./send-target.ts";

const Span = { start: Count, end: Count };
const ordered = (span: { readonly start: number; readonly end: number }) => span.start < span.end;
const TextSpan = Schema.Struct(Span).check(Schema.makeFilter(ordered));
const FileId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);
/** Exact raw native segment slice; UTF-16 offsets, never normalized or trimmed. */
export const OfficeDocTextSelection = Schema.Struct({
  kind: Schema.Literal("doc-text"),
  segmentId: Schema.String.check(Schema.isMaxLength(96)),
  segmentPage: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(-1),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
  startOffset: Count,
  endOffset: Count,
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
}).check(
  Schema.makeFilter(
    (scope) =>
      scope.startOffset < scope.endOffset &&
      scope.text.length === scope.endOffset - scope.startOffset &&
      Array.from(scope.text).every(
        (character) => character.length === 2 || !/[\uD800-\uDFFF]/.test(character),
      ) &&
      (scope.segmentId === "" ? scope.segmentPage === -1 : scope.segmentPage >= 0),
  ),
);
export type OfficeDocTextSelection = typeof OfficeDocTextSelection.Type;

export const OfficeNativeReferenceContext = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("whole") }),
  Schema.Struct({ kind: Schema.Literal("sheet-range"), ...OfficeSheetSelection.fields }).check(
    Schema.makeFilter((scope) =>
      scope.ranges.every(
        (range) => range.startRow <= range.endRow && range.startColumn <= range.endColumn,
      ),
    ),
  ),
  OfficeDocTextSelection,
]);
export type OfficeNativeReferenceContext = typeof OfficeNativeReferenceContext.Type;

/** Occurrence identity and inclusive/exclusive caption span, not a label-derived authority. */
export const ChatReferenceInput = Schema.Union([
  Schema.Struct({
    id: Id,
    ...Span,
    kind: Schema.Literal("original"),
    fileId: FileId,
    text: Schema.optionalKey(TextSpan),
  }),
  Schema.Struct({
    id: Id,
    ...Span,
    kind: Schema.Literal("native"),
    target: OfficeSendTarget,
    context: OfficeNativeReferenceContext,
  }).check(
    Schema.makeFilter(
      (input) =>
        // Legacy observed context is not an explicit reference capture.
        input.target.context === undefined &&
        (input.context.kind === "whole" ||
          (input.context.kind === "sheet-range" && input.target.documentKind === "sheet") ||
          (input.context.kind === "doc-text" && input.target.documentKind === "doc")),
    ),
  ),
]).check(Schema.makeFilter(ordered));
export type ChatReferenceInput = typeof ChatReferenceInput.Type;

export const ChatReferenceInputs = Schema.Array(ChatReferenceInput).check(
  Schema.isMaxLength(MAX_OFFICE_SEND_ATTACHMENTS),
  Schema.makeFilter((inputs) => {
    if (new Set(inputs.map((input) => input.id)).size !== inputs.length) return false;
    const spans = inputs.toSorted((a, b) => a.start - b.start);
    return spans.every((span, index) => (spans[index - 1]?.end ?? 0) <= span.start);
  }),
);
export type ChatReferenceInputs = typeof ChatReferenceInputs.Type;

/** Decode with excess-key rejection, clone, and recursively freeze before the first await. */
export const freezeChatReferenceInputs = (input: ChatReferenceInputs): ChatReferenceInputs =>
  Object.freeze(
    decodeWireSync(ChatReferenceInputs)(input).map((entry) => {
      if (entry.kind === "original")
        return Object.freeze({
          ...entry,
          ...(entry.text === undefined ? {} : { text: Object.freeze({ ...entry.text }) }),
        });
      const context =
        entry.context.kind === "sheet-range"
          ? Object.freeze({
              ...entry.context,
              ranges: Object.freeze(
                entry.context.ranges.map((range) => Object.freeze({ ...range })),
              ),
            })
          : Object.freeze({ ...entry.context });
      return Object.freeze({
        ...entry,
        target: freezeOfficeSendTarget({ ...entry.target }),
        context,
      });
    }),
  );

const contextIdentity = (context: OfficeNativeReferenceContext): readonly unknown[] => {
  if (context.kind === "whole") return [context.kind];
  if (context.kind === "doc-text")
    return [
      context.kind,
      context.segmentId,
      context.segmentPage,
      context.startOffset,
      context.endOffset,
      context.text,
    ];
  return [
    context.kind,
    context.sheetId,
    context.sheetName ?? null,
    context.ranges.map((range) => [
      range.startRow,
      range.startColumn,
      range.endRow,
      range.endColumn,
      range.a1 ?? null,
    ]),
  ];
};
/** Append only for nonempty inputs: absence/empty must retain historical Send identity bytes. */
export const chatReferenceInputsIdentity = (inputs: ChatReferenceInputs): readonly unknown[] => [
  "message-references",
  1,
  inputs.map((entry) => [
    entry.id,
    entry.start,
    entry.end,
    entry.kind,
    ...(entry.kind === "original"
      ? [entry.fileId, entry.text === undefined ? null : [entry.text.start, entry.text.end]]
      : [officeSendTargetIdentity(entry.target), contextIdentity(entry.context)]),
  ]),
];
