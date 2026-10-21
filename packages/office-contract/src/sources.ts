import { Schema } from "effect";
import * as Endpoint from "effect/http-api/HttpApiEndpoint";
import { OfficeErrors } from "./errors.ts";
import { Count, Cursor, DocumentParams, Id, Label, PageQuery } from "./primitives.ts";

/** Confirmed draft import history, not a claim about merged/current main content. */
export const OfficeSourceLink = Schema.Struct({
  operationId: Id,
  uploadId: Id,
  documentId: Id,
  draftId: Id,
  generation: Count,
  chatId: Id,
  fileRef: Id,
  name: Label,
});
export type OfficeSourceLink = typeof OfficeSourceLink.Type;
export const OfficeSourcePage = Schema.Struct({
  items: Schema.Array(OfficeSourceLink).check(Schema.isMaxLength(20)),
  next: Cursor,
});
export type OfficeSourcePage = typeof OfficeSourcePage.Type;
export const OfficeSourceRequest = Schema.Struct({ documentId: Id, cursor: Cursor });
export const OfficeSourcesEndpoint = Endpoint.get(
  "sources",
  "/api/office/documents/:documentId/sources",
  {
    params: DocumentParams,
    query: PageQuery,
    error: OfficeErrors,
    success: OfficeSourcePage,
  },
);
