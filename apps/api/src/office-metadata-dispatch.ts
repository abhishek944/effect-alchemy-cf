import { Effect, Schema } from "effect";
import {
  decodeWire,
  OfficeErrors,
  OfficeInvalid,
  OfficeUnavailable,
  safeFailure,
  type OfficeError,
} from "@starter/office-contract";
import { HostMetadata } from "@starter/office-server/native-remote";
import type { OfficeMetadata } from "@starter/office-server/ports";
import { writeOfficeMetadata } from "./office-metadata-write.ts";

const methods = Object.values(HostMetadata);
const Request = Schema.Union(methods.map((method) => method.request));
const Response = Schema.Union(methods.map((method) => method.response));
const isOfficeError = Schema.is(Schema.Union(OfficeErrors));
export type OfficeMetadataCall = typeof Request.Type;
export type OfficeMetadataResponse = typeof Response.Type;
type MetadataValue = Effect.Success<ReturnType<OfficeMetadata[keyof OfficeMetadata]>>;
/** Internal pre-validation result, never a wire response or authority. */
export type OfficeMetadataResult = {
  readonly method: OfficeMetadataCall["method"];
  readonly value: Exclude<MetadataValue, void> | null;
};

/** Parent supplies genuine original private admission; this component mounts no route or issuer. */
export function dispatchOfficeMetadata(
  metadata: OfficeMetadata,
  authorize: (call: OfficeMetadataCall) => Effect.Effect<void, OfficeError>,
  payload: unknown,
): Effect.Effect<OfficeMetadataResponse, OfficeError> {
  return Effect.suspend(() => {
    let mutation = false;
    const unavailable = () =>
      new OfficeUnavailable(safeFailure(mutation ? "OUTCOME_UNKNOWN" : "UNAVAILABLE"));
    const failure = (cause: unknown) => Effect.fail(isOfficeError(cause) ? cause : unavailable());
    return Effect.gen(function* () {
      const call = yield* decodeWire(Request)(payload).pipe(
        Effect.mapError(() => new OfficeInvalid(safeFailure("INVALID_INPUT"))),
      );
      yield* authorize(call);
      let result: OfficeMetadataResult;
      switch (call.method) {
        case "metadata.document":
          result = {
            method: call.method,
            value: yield* metadata.document(call.input.owner, call.input.documentId),
          };
          break;
        case "metadata.documents":
          result = {
            method: call.method,
            value: yield* metadata.documents(call.input.owner, call.input.cursor),
          };
          break;
        case "metadata.draft":
          result = {
            method: call.method,
            value: yield* metadata.draft(call.input.owner, call.input.draftId),
          };
          break;
        case "metadata.drafts":
          result = {
            method: call.method,
            value: yield* metadata.drafts(call.input.owner, call.input.cursor),
          };
          break;
        case "metadata.view":
          result = {
            method: call.method,
            value: yield* metadata.view(call.input.owner, call.input.viewId),
          };
          break;
        case "metadata.historicalViewTarget":
          result = {
            method: call.method,
            value: yield* metadata.historicalViewTarget(call.input.owner, call.input.viewId),
          };
          break;
        case "metadata.editor":
          result = {
            method: call.method,
            value: yield* metadata.editor(call.input.owner, call.input.editorId),
          };
          break;
        case "metadata.editors":
          result = {
            method: call.method,
            value: yield* metadata.editors(call.input.owner, call.input.documentId),
          };
          break;
        case "metadata.job":
          result = {
            method: call.method,
            value: yield* metadata.job(call.input.owner, call.input.jobId),
          };
          break;
        case "metadata.operation":
          result = {
            method: call.method,
            value: yield* metadata.operation(call.input.owner, call.input.operationId),
          };
          break;
        case "metadata.review":
          result = {
            method: call.method,
            value: yield* metadata.review(call.input.owner, call.input.reviewId),
          };
          break;
        case "metadata.approval":
          result = {
            method: call.method,
            value: yield* metadata.approval(call.input.owner, call.input.operationId),
          };
          break;
        case "metadata.publicationBarrier":
          result = {
            method: call.method,
            value: yield* metadata.publicationBarrier(call.input.owner, call.input.documentId),
          };
          break;
        case "metadata.writes":
          result = {
            method: call.method,
            value: yield* metadata.writes(
              call.input.owner,
              call.input.operationId,
              call.input.cursor,
            ),
          };
          break;
        case "metadata.events":
          result = {
            method: call.method,
            value: yield* metadata.events(
              call.input.owner,
              call.input.documentId,
              call.input.after,
            ),
          };
          break;
        case "metadata.reserveDocument":
        case "metadata.publishDocument":
        case "metadata.reserveDraft":
        case "metadata.advanceGeneration":
        case "metadata.putView":
        case "metadata.changeEditor":
        case "metadata.reserveJob":
        case "metadata.advanceJob":
        case "metadata.reserveOperation":
        case "metadata.advanceOperation":
        case "metadata.claimQueued":
        case "metadata.putReview":
        case "metadata.approve":
        case "metadata.admitPublication":
        case "metadata.finishPublication":
        case "metadata.stageWrite":
        case "metadata.prepareWrite":
        case "metadata.confirmWrite":
          mutation = true;
          result = yield* writeOfficeMetadata(metadata, call);
          break;
        default: {
          const exhaustive: never = call;
          return exhaustive;
        }
      }
      return yield* decodeWire(Response)(result).pipe(Effect.mapError(unavailable));
    }).pipe(Effect.catch(failure), Effect.catchDefect(failure));
  });
}
