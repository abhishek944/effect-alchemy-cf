import { Schema } from "effect";
import { Cursor, Id, Target } from "./primitives.ts";
import { OFFICE_LIMITS } from "./limits.ts";
import {
  CreateDocument,
  CreateDraft,
  DraftTransition,
  Execute,
  ExportRequest,
  RenderRequest,
} from "./requests.ts";
import { InspectRequest } from "./content.ts";
import { ImportInto } from "./import-into.ts";

const encoder = new TextEncoder();
const malformedUtf16 = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
export const CodeText = Schema.String.check(
  Schema.isMaxLength(OFFICE_LIMITS.codeBytes),
  Schema.makeFilter(
    (source: string) =>
      !malformedUtf16.test(source) && encoder.encode(source).byteLength <= OFFICE_LIMITS.codeBytes,
  ),
);
/** Transient command source only: stage bytes first; never put this command in OperationIntent. */
export const StageCode = Schema.Struct({ operationId: Id, source: CodeText });
export type StageCode = typeof StageCode.Type;
/** Host resolves an immutable file from this invocation's accepted attachments, not a URL/path. */
export const StageFile = Schema.Struct({ operationId: Id, fileRef: Id });
export type StageFile = typeof StageFile.Type;
/** Model/CLI task capability: no approval, merge, owner, upstream URL, paths or shell string. */
const TaskCreation = Schema.Struct({
  ...CreateDocument.fields,
  destination: Schema.Literal("new-draft"),
});
export const OfficeCommand = Schema.Union([
  Schema.Struct({ command: Schema.Literal("list"), cursor: Cursor }),
  Schema.Struct({ command: Schema.Literal("drafts"), cursor: Cursor }),
  Schema.Struct({ command: Schema.Literal("draft"), draftId: Id }),
  Schema.Struct({ command: Schema.Literal("open"), input: Target }),
  Schema.Struct({ command: Schema.Literal("stage-code"), input: StageCode }),
  Schema.Struct({ command: Schema.Literal("stage-file"), input: StageFile }),
  Schema.Struct({ command: Schema.Literal("create"), input: TaskCreation }),
  Schema.Struct({ command: Schema.Literal("create-draft"), input: CreateDraft }),
  Schema.Struct({ command: Schema.Literal("execute"), input: Execute }),
  Schema.Struct({ command: Schema.Literal("import-into"), input: ImportInto }),
  Schema.Struct({ command: Schema.Literal("inspect"), input: InspectRequest }),
  Schema.Struct({ command: Schema.Literal("render"), input: RenderRequest }),
  Schema.Struct({ command: Schema.Literal("export"), input: ExportRequest }),
  Schema.Struct({ command: Schema.Literal("ready"), input: DraftTransition }),
  Schema.Struct({ command: Schema.Literal("reopen"), input: DraftTransition }),
  Schema.Struct({ command: Schema.Literal("discard"), input: DraftTransition }),
  Schema.Struct({ command: Schema.Literal("review"), reviewId: Id, cursor: Cursor }),
  Schema.Struct({ command: Schema.Literal("operation"), operationId: Id }),
]);
export type OfficeCommand = typeof OfficeCommand.Type;
