import { Schema } from "effect";
import * as HttpApi from "effect/http-api/HttpApi";
import * as Endpoint from "effect/http-api/HttpApiEndpoint";
import * as Group from "effect/http-api/HttpApiGroup";
import { OfficeBinaryEndpoints } from "./binary-api.ts";
import { ImportIntoEndpoint } from "./import-api.ts";
import { OfficeChannelEndpoint } from "./channel.ts";
import { OfficeSourceEndpoints } from "./sources.ts";
export { BINARY_UPLOAD_PATH, UploadHeaders } from "./binary-api.ts";
import { OfficeErrors } from "./errors.ts";
import {
  Count,
  Cursor,
  DocumentParams,
  DraftParams,
  Id,
  OperationParams,
  PageQuery,
  Target,
} from "./primitives.ts";
import {
  Document,
  DocumentPage,
  Draft,
  DraftPage,
  Editor,
  EventPage,
  Receipt,
  View,
} from "./models.ts";
import {
  Approve,
  CreateDocument,
  CreateDraft,
  DraftTransition,
  EditorAction,
  Execute,
  ExportRequest,
  Merge,
  RenderRequest,
} from "./requests.ts";
import { InspectRequest, Inspection } from "./content.ts";
import { ReviewPage } from "./review.ts";

export class OfficeGroup extends Group.make("office")
  .add(
    Endpoint.get("list", "/api/office/documents", {
      query: PageQuery,
      error: OfficeErrors,
      success: DocumentPage,
    }),
  )
  .add(
    Endpoint.get("drafts", "/api/office/drafts", {
      query: PageQuery,
      error: OfficeErrors,
      success: DraftPage,
    }),
  )
  .add(
    Endpoint.get("document", "/api/office/documents/:documentId", {
      params: DocumentParams,
      error: OfficeErrors,
      success: Document,
    }),
  )
  .add(
    Endpoint.get("draft", "/api/office/drafts/:draftId", {
      params: DraftParams,
      error: OfficeErrors,
      success: Draft,
    }),
  )
  .add(
    Endpoint.post("create", "/api/office/documents", {
      payload: CreateDocument,
      error: OfficeErrors,
      success: Receipt,
    }),
  )
  .add(
    Endpoint.post("createDraft", "/api/office/drafts", {
      payload: CreateDraft,
      error: OfficeErrors,
      success: Receipt,
    }),
  )
  .add(
    Endpoint.post("open", "/api/office/views", {
      payload: Target,
      error: OfficeErrors,
      success: View,
    }),
  )
  .add(
    Endpoint.post("editor", "/api/office/editors", {
      payload: EditorAction,
      error: OfficeErrors,
      success: Editor,
    }),
  )
  .add(
    Endpoint.post("execute", "/api/office/execute", {
      payload: Execute,
      error: OfficeErrors,
      success: Receipt,
    }),
  )
  .add(
    Endpoint.post("inspect", "/api/office/inspect", {
      payload: InspectRequest,
      error: OfficeErrors,
      success: Inspection,
    }),
  )
  .add(
    Endpoint.post("render", "/api/office/render", {
      payload: RenderRequest,
      error: OfficeErrors,
      success: Receipt,
    }),
  )
  .add(
    Endpoint.post("export", "/api/office/export", {
      payload: ExportRequest,
      error: OfficeErrors,
      success: Receipt,
    }),
  )
  .add(
    Endpoint.post("ready", "/api/office/ready", {
      payload: DraftTransition,
      error: OfficeErrors,
      success: Receipt,
    }),
  )
  .add(
    Endpoint.get("review", "/api/office/reviews/:reviewId", {
      params: Schema.Struct({ reviewId: Id }),
      query: PageQuery,
      error: OfficeErrors,
      success: ReviewPage,
    }),
  )
  .add(
    Endpoint.post("approve", "/api/office/approve", {
      payload: Approve,
      error: OfficeErrors,
      success: Receipt,
    }),
  )
  .add(
    Endpoint.post("merge", "/api/office/merge", {
      payload: Merge,
      error: OfficeErrors,
      success: Receipt,
    }),
  )
  .add(
    Endpoint.post("reopen", "/api/office/reopen", {
      payload: DraftTransition,
      error: OfficeErrors,
      success: Receipt,
    }),
  )
  .add(
    Endpoint.post("discard", "/api/office/discard", {
      payload: DraftTransition,
      error: OfficeErrors,
      success: Receipt,
    }),
  )
  .add(
    Endpoint.get("receipt", "/api/office/operations/:operationId", {
      params: OperationParams,
      error: OfficeErrors,
      success: Receipt,
    }),
  )
  .add(
    Endpoint.post("cancel", "/api/office/operations/:operationId/cancel", {
      params: OperationParams,
      error: OfficeErrors,
      success: Receipt,
    }),
  )
  .add(
    Endpoint.get("events", "/api/office/documents/:documentId/events", {
      params: DocumentParams,
      query: Schema.Struct({ after: Count, cursor: Schema.optional(Cursor) }),
      error: OfficeErrors,
      success: EventPage,
    }),
  )
  .add(ImportIntoEndpoint, OfficeChannelEndpoint, ...OfficeSourceEndpoints)
  .add(...OfficeBinaryEndpoints) {}
export class OfficeApi extends HttpApi.make("office")
  .add(OfficeGroup)
  .annotate(HttpApi.ParseOptions, { onExcessProperty: "error" })
  .annotate(HttpApi.HeadersParseOptions, {}) {}
