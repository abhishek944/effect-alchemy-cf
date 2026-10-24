import { Schema } from "effect";
import * as Endpoint from "effect/http-api/HttpApiEndpoint";
import { OfficeErrors } from "./errors.ts";
import { ArtifactRef } from "./models.ts";
import { Count, Cursor, DocumentParams, Id, Label, PageQuery, Target } from "./primitives.ts";

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
/** Content discovery only; never an original-operation control receipt or native grant. */
export const OfficeOriginalRequest = Schema.Struct({ chatId: Id, fileRef: Id });
export const OfficeOriginalTarget = Schema.NullOr(Target);
export const OfficeSourceReadRequest = Schema.Union([OfficeSourceRequest, OfficeOriginalRequest]);
export const OfficeOriginalEndpoint = Endpoint.get("original", "/api/office/originals/:fileRef", {
  params: Schema.Struct({ fileRef: Id }),
  query: Schema.Struct({ chatId: Id }),
  error: OfficeErrors,
  success: OfficeOriginalTarget,
});
export const OfficeOriginalStageEndpoint = Endpoint.post(
  "stageOriginal",
  "/api/office/originals/:fileRef/stage",
  {
    params: Schema.Struct({ fileRef: Id }),
    payload: Schema.Struct({ chatId: Id }),
    error: OfficeErrors,
    success: ArtifactRef,
  },
);
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
export const OfficeSourceEndpoints = [
  OfficeSourcesEndpoint,
  OfficeOriginalEndpoint,
  OfficeOriginalStageEndpoint,
] as const;
