import { Schema } from "effect";
import { Id } from "@starter/office-contract";
export const OfficePanelRequest = Schema.Struct({ attachmentId: Id });
export const UniverCliRequest = Schema.Struct({
  attachmentId: Id,
  command: Schema.Array(Schema.String.check(Schema.isMaxLength(32_768))).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(32),
  ),
});
export type UniverCliRequest = typeof UniverCliRequest.Type;
const document = Schema.toJsonSchemaDocument(UniverCliRequest);
export const officeToolParameters = { ...document.schema, $defs: document.definitions };
