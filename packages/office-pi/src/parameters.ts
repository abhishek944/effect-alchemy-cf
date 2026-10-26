import { Schema } from "effect";
import { Id } from "@starter/office-contract";
export const OfficePanelRequest = Schema.Union([
  Schema.Struct({ attachmentId: Id }),
  Schema.Struct({ referenceId: Id }),
]);
export type OfficeToolSource = typeof OfficePanelRequest.Type;
const Command = Schema.Array(Schema.String.check(Schema.isMaxLength(32_768))).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(32),
);
export const UniverCliRequest = Schema.Union([
  Schema.Struct({ attachmentId: Id, command: Command }),
  Schema.Struct({ referenceId: Id, command: Command }),
]);
export type UniverCliRequest = typeof UniverCliRequest.Type;
/** Discovery page selector only: no owner, chat, kind or file argument is accepted. */
export const AttachmentListRequest = Schema.Struct({
  cursor: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))),
});
export type AttachmentListRequest = typeof AttachmentListRequest.Type;
const document = Schema.toJsonSchemaDocument(UniverCliRequest, { onExcessProperty: "error" });
export const officeToolParameters = { ...document.schema, $defs: document.definitions };
const attachments = Schema.toJsonSchemaDocument(AttachmentListRequest, {
  onExcessProperty: "error",
});
export const attachmentListParameters = { ...attachments.schema, $defs: attachments.definitions };
