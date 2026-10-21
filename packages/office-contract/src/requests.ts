import { Schema } from "effect";
import { Count, DraftTarget, Id, Kind, Revision, Target, Title } from "./primitives.ts";

const NativeId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));

export const ImportOptions = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("sheet"),
    format: Schema.Literals(["xls", "xlsx"]),
    calculate: Schema.Literals(["no", "when_empty"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("sheet"),
    format: Schema.Literals(["csv", "tsv"]),
    delimiter: Schema.Literals(["auto", "comma", "tab", "semicolon"]),
    inferTypes: Schema.Literals(["off", "safe"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("doc"),
    format: Schema.Literals(["doc", "docx"]),
    compatibility: Schema.Literals(["traditional", "modern"]),
  }),
  Schema.Struct({ kind: Schema.Literal("slide"), format: Schema.Literals(["ppt", "pptx"]) }),
]);
export type ImportOptions = typeof ImportOptions.Type;
export const CreationSource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("blank"), documentKind: Kind }),
  Schema.Struct({ kind: Schema.Literal("office"), uploadId: Id, options: ImportOptions }),
]);
export const CreateDocument = Schema.Struct({
  operationId: Id,
  title: Title,
  destination: Schema.Literals(["main", "new-draft"]),
  source: CreationSource,
});
export type CreateDocument = typeof CreateDocument.Type;
export const CreateDraft = Schema.Struct({ operationId: Id, documentId: Id });
export type CreateDraft = typeof CreateDraft.Type;
export const Execute = Schema.Struct({ operationId: Id, target: DraftTarget, codeId: Id });
export type Execute = typeof Execute.Type;
export const DraftTransition = Schema.Struct({ operationId: Id, draftId: Id, generation: Count });
export type DraftTransition = typeof DraftTransition.Type;
export const Approve = Schema.Struct({ operationId: Id, reviewId: Id });
export type Approve = typeof Approve.Type;
export const Merge = Schema.Struct({ operationId: Id, approvalOperationId: Id });
export type Merge = typeof Merge.Type;
export const ReviewRequest = Schema.Struct({ reviewId: Id });
export const ExportOptions = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("sheet"), format: Schema.Literal("xlsx") }),
  Schema.Struct({
    kind: Schema.Literal("sheet"),
    format: Schema.Literals(["csv", "tsv"]),
    worksheetId: NativeId,
  }),
  Schema.Struct({ kind: Schema.Literal("doc"), format: Schema.Literal("docx") }),
  Schema.Struct({ kind: Schema.Literal("slide"), format: Schema.Literal("pptx") }),
]);
export type ExportOptions = typeof ExportOptions.Type;
export const RenderSelection = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("sheet"),
    worksheetId: NativeId,
    range: Schema.String.check(
      Schema.isPattern(/^[A-Z]{1,4}[1-9][0-9]{0,6}(:[A-Z]{1,4}[1-9][0-9]{0,6})?$/),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("doc"),
    pages: Schema.Array(Revision).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  }),
  Schema.Struct({
    kind: Schema.Literal("slide"),
    pages: Schema.Array(NativeId).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
  }),
]);
export type RenderSelection = typeof RenderSelection.Type;
export const ExportRequest = Schema.Struct({ operationId: Id, viewId: Id, options: ExportOptions });
export type ExportRequest = typeof ExportRequest.Type;
export const RenderRequest = Schema.Struct({
  operationId: Id,
  viewId: Id,
  selection: RenderSelection,
});
export type RenderRequest = typeof RenderRequest.Type;
export const EditorAction = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("acquire"), target: Target }),
  Schema.Struct({ kind: Schema.Literal("renew"), editorId: Id }),
  Schema.Struct({ kind: Schema.Literal("drained"), editorId: Id, confirmedRevision: Count }),
  Schema.Struct({
    kind: Schema.Literal("revoke"),
    editorId: Id,
    discardUnconfirmed: Schema.Literal(true),
  }),
]);
export type EditorAction = typeof EditorAction.Type;
