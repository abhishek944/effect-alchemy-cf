import { Schema } from "effect";
import * as Endpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import { OfficeErrors } from "./errors.ts";
import { ArtifactParams, Count, OperationParams } from "./primitives.ts";
import { ArtifactRef } from "./models.ts";

/** Native handlers stream the raw body; never decode it as JSON/base64. */
export const BINARY_UPLOAD_PATH = "/api/office/uploads/:operationId";
export const UploadHeaders = Schema.Struct({
  "x-office-kind": Schema.Literals(["upload", "code"]),
  "x-office-filename": Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  "x-office-bytes": Count,
  "x-office-digest": Schema.optional(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
});
export type UploadHeaders = typeof UploadHeaders.Type;
export const OfficeBinaryEndpoints = [
  Endpoint.put("upload", BINARY_UPLOAD_PATH, {
    params: OperationParams,
    headers: UploadHeaders,
    error: OfficeErrors,
    success: ArtifactRef,
  }),
  Endpoint.get("artifact", "/api/office/artifacts/:artifactId", {
    params: ArtifactParams,
    error: OfficeErrors,
    success: ArtifactRef,
  }),
  Endpoint.get("download", "/api/office/artifacts/:artifactId/bytes", {
    params: ArtifactParams,
    error: OfficeErrors,
    success: HttpApiSchema.StreamUint8Array(),
  }),
] as const;
