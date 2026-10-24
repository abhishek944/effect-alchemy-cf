import { withCause } from "@starter/diagnostics";
import { Effect, Schema } from "effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import {
  OfficeConflict,
  OfficeErrors,
  OfficeForbidden,
  OfficeInvalid,
  OfficeLimited,
  OfficeNotFound,
  OfficeUnauthorized,
  OfficeUnavailable,
  safeFailure,
} from "@starter/office-contract";
import type { Failure, OfficeError } from "@starter/office-contract";

export const OFFICE_HTTP_METADATA_BYTES = 16 * 1024;
const statusOf = (error: OfficeError): number =>
  Schema.is(OfficeInvalid)(error)
    ? 400
    : Schema.is(OfficeUnauthorized)(error)
      ? 401
      : Schema.is(OfficeForbidden)(error)
        ? 403
        : Schema.is(OfficeNotFound)(error)
          ? 404
          : Schema.is(OfficeConflict)(error)
            ? 409
            : Schema.is(OfficeLimited)(error)
              ? 413
              : 503;
const encodeOfficeError = Schema.encodeSync(Schema.Union([...OfficeErrors]));
export const unavailable = (cause?: unknown): OfficeError => {
  for (const Type of OfficeErrors) if (cause instanceof Type) return cause;
  return withCause(new OfficeUnavailable(safeFailure("UNAVAILABLE")), cause);
};
export const invalid = (cause?: unknown): OfficeError => {
  for (const Type of OfficeErrors) if (cause instanceof Type) return cause;
  return withCause(new OfficeInvalid(safeFailure("INVALID_INPUT")), cause);
};

/** One Failure-to-error classification for public HTTP replies and the private command port. */
export const officeErrorFromFailure = (failure: Failure): OfficeError =>
  failure.code === "UNAUTHENTICATED"
    ? new OfficeUnauthorized(failure)
    : failure.code === "FORBIDDEN"
      ? new OfficeForbidden(failure)
      : failure.code === "NOT_FOUND"
        ? new OfficeNotFound(failure)
        : failure.code === "INVALID_INPUT" || failure.code === "CONTENT_REQUIRED"
          ? new OfficeInvalid(failure)
          : failure.code === "LIMIT_EXCEEDED"
            ? new OfficeLimited(failure)
            : failure.code === "IDEMPOTENCY_CONFLICT" ||
                failure.code === "NOT_EDITABLE" ||
                failure.code === "STALE_BASIS" ||
                failure.code === "STALE_REVIEW" ||
                failure.code === "NATIVE_CONFLICT"
              ? new OfficeConflict(failure)
              : new OfficeUnavailable(failure);

/** Public Office error encoding: real tagged error with only the safe failure fields. */
export function officeFailure(failure: Failure): HttpServerResponse.HttpServerResponse {
  const error = officeErrorFromFailure(failure);
  return HttpServerResponse.setHeader(
    HttpServerResponse.jsonUnsafe(encodeOfficeError(error), { status: statusOf(error) }),
    "cache-control",
    "private, no-store",
  );
}
export const officeInvalid = () => officeFailure(safeFailure("INVALID_INPUT"));
export const officeJson = (value: unknown, status = 200) =>
  HttpServerResponse.setHeader(
    HttpServerResponse.jsonUnsafe(value, { status }),
    "cache-control",
    "private, no-store",
  );

/** Structural reader both the native Response body and the incoming request stream satisfy. */
type OfficeChunkReader = {
  read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array | undefined }>;
  cancel(reason?: unknown): Promise<void>;
  readonly closed: Promise<void>;
  releaseLock(): void;
};
/** Bounded, fully joined read: cancelled, closed and released before return; no drift on bytes. */
const readChunks = async (reader: OfficeChunkReader, maximum: number): Promise<Uint8Array> => {
  const closed = reader.closed.then(
    () => undefined,
    () => undefined,
  );
  const bytes = new Uint8Array(maximum);
  let count = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array)) throw new Error("invalid chunk");
      if (chunk.byteLength > maximum - count) throw new Error("stream exceeds limit");
      bytes.set(chunk, count);
      count += chunk.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    await closed;
    try {
      reader.releaseLock();
    } catch {
      // Already released after natural completion.
    }
  }
  return bytes.subarray(0, count);
};
/** Private reply reader: the actual platform Response body, never a copied bridge. */
export const readBounded = (
  response: Response,
  maximum: number,
): Effect.Effect<Uint8Array, OfficeError> =>
  Effect.tryPromise({
    try: () => {
      if (response.body === null) return Promise.reject(new Error("empty reply"));
      return readChunks(response.body.getReader(), maximum);
    },
    catch: unavailable,
  });
export const officeReadBytes = readBounded;
export const officeJsonValue = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return null;
  }
};

/** Bounded JSON metadata read for one public request body; no unbounded text/arrayBuffer read. */
export const officeReadJson = (
  body: ReadableStream<Uint8Array> | null,
  maximum: number = OFFICE_HTTP_METADATA_BYTES,
): Effect.Effect<unknown, OfficeError> =>
  Effect.gen(function* () {
    if (body === null) return yield* Effect.fail(invalid());
    const bytes = yield* Effect.tryPromise({
      try: () => readChunks(body.getReader(), maximum),
      catch: unavailable,
    });
    return yield* Effect.try({
      try: (): unknown =>
        JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)),
      catch: invalid,
    });
  });
