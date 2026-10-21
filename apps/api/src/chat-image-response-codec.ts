import { Option, Schema } from "effect";
import { type ImageAcceptedBinding, ImageResponseCandidate } from "./chat-image-response-schema.ts";

import {
  isBoundedImageResponseJson,
  MAX_IMAGE_RESPONSE_JSON_BYTES,
} from "./chat-image-response-json.ts";
export { MAX_IMAGE_RESPONSE_JSON_BYTES } from "./chat-image-response-json.ts";
export type ImageResponseErrorCode = "invalid_input" | "conflict" | "corrupt" | "storage_error";
export class ImageResponseError extends Error {
  readonly code: ImageResponseErrorCode;
  constructor(code: ImageResponseErrorCode) {
    super(`Image response: ${code}`);
    this.name = "ImageResponseError";
    this.code = code;
  }
}

export function responseBoundary<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof ImageResponseError) throw error;
    throw new ImageResponseError("storage_error");
  }
}

export function responseValue<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
  code: ImageResponseErrorCode = "invalid_input",
): S["Type"] {
  const value = Option.getOrNull(
    Schema.decodeUnknownOption(schema, {
      onExcessProperty: "error",
    })(input),
  );
  if (value === null) throw new ImageResponseError(code);
  return value;
}

// Fixed key order makes structural equality independent of callers' insertion order.
const candidateKeys = [
  "version",
  "operationId",
  "logicalOperationId",
  "identityHash",
  "ownerId",
  "chatId",
  "chatScope",
  "conversationId",
  "applicationOrigin",
  "image",
  "state",
  "reason",
  "preferences",
  "revision",
  "model",
  "size",
  "quality",
  "gatewayId",
  "inputDigest",
  "originals",
  "fileId",
  "digest",
  "url",
  "originOperationId",
  "kind",
  "name",
  "byteSize",
  "mediaType",
  "width",
  "height",
  "officeTarget",
  "viewId",
  "documentId",
  "documentKind",
  "expectedRevision",
  "draftId",
  "generation",
];
export function encodeCandidate(input: ImageResponseCandidate): string {
  if (!isBoundedImageResponseJson(input)) throw new ImageResponseError("invalid_input");
  const valid = responseValue(ImageResponseCandidate, input);
  const json = JSON.stringify(valid, candidateKeys);
  if (new TextEncoder().encode(json).byteLength > MAX_IMAGE_RESPONSE_JSON_BYTES)
    throw new ImageResponseError("invalid_input");
  return json;
}

export function decodeCandidate(json: string): ImageResponseCandidate {
  try {
    if (
      typeof json !== "string" ||
      json.length > MAX_IMAGE_RESPONSE_JSON_BYTES ||
      new TextEncoder().encode(json).byteLength > MAX_IMAGE_RESPONSE_JSON_BYTES
    )
      throw new ImageResponseError("corrupt");
    const value = responseValue(ImageResponseCandidate, JSON.parse(json), "corrupt");
    for (const original of value.originals) Object.freeze(original);
    Object.freeze(value.originals);
    if (value.image.state === "ready") Object.freeze(value.image.preferences);
    Object.freeze(value.image);
    if (value.officeTarget !== undefined) Object.freeze(value.officeTarget);
    return Object.freeze(value);
  } catch {
    throw new ImageResponseError("corrupt");
  }
}

export const bindingJson = (input: ImageAcceptedBinding): string =>
  JSON.stringify([
    input.operationId,
    input.submissionId,
    input.conversationId,
    input.entryId,
    input.modelIndex,
    input.inputDigest,
  ]);
