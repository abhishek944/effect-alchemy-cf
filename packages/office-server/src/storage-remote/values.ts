import { Effect } from "effect";
import { decodeWire, type OfficeError } from "@starter/office-contract";
import type { NativeAccess } from "../ports/index.ts";
import { collectBytes } from "../core/bytes.ts";
import { officeFailure } from "../core/failure.ts";
import { sha256 } from "../core/operations.ts";
import {
  nativeValueDigest,
  validateNativeValueRef,
  type NativeValue,
  PublishedOrigin,
} from "./wire.ts";

/** Bound, authenticated private transport. No arbitrary URL/key or cross-origin fallback. */
export interface PublishedNativeReader {
  readonly access: Extract<NativeAccess, { kind: "read" }>;
  readonly worktreeId: string | null;
  readonly baselineRevision: number | null;
  readPart(input: {
    readonly origin: PublishedOrigin;
    readonly valueDigest: string;
    readonly part: number;
  }): Effect.Effect<ReadableStream<Uint8Array>, OfficeError>;
}
/** Node reassembles one bounded value. Worker sends pieces/headers, never decoded aggregates. */
export const loadPublishedValue = Effect.fn("Office.loadPublishedValue")(function* (
  reader: PublishedNativeReader,
  source: PublishedOrigin,
  input: NativeValue,
) {
  const origin = yield* decodeWire(PublishedOrigin)(source).pipe(
    Effect.mapError(() => officeFailure("FORBIDDEN")),
  );
  const ref = yield* Effect.try({
    try: () => validateNativeValueRef(input),
    catch: () => officeFailure("CONTENT_REQUIRED"),
  });
  const digest = yield* Effect.tryPromise({
    try: () => nativeValueDigest(ref),
    catch: () => officeFailure("CONTENT_REQUIRED"),
  });
  if ((reader.access.target.scope.kind === "draft") !== (reader.worktreeId !== null))
    return yield* Effect.fail(officeFailure("FORBIDDEN"));
  if (
    (origin.kind === "seed" || origin.kind === "merge-artifact") &&
    origin.worktreeID !== reader.worktreeId
  )
    return yield* Effect.fail(officeFailure("FORBIDDEN"));
  if (origin.kind === "changeset" && origin.branch !== "" && origin.branch !== reader.worktreeId)
    return yield* Effect.fail(officeFailure("FORBIDDEN"));
  if (
    reader.worktreeId !== null &&
    (origin.kind === "snapshot" || (origin.kind === "changeset" && origin.branch === "")) &&
    (reader.baselineRevision === null || origin.revision > reader.baselineRevision)
  )
    return yield* Effect.fail(officeFailure("FORBIDDEN"));
  // Broker independently checks actual published reachability, lifecycle and each current grant.
  const bytes = new Uint8Array(ref.bytes);
  let offset = 0;
  for (let index = 0; index < ref.parts.length; index++) {
    const part = ref.parts[index];
    if (part === undefined) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
    const stream = yield* reader.readPart({ origin, valueDigest: digest, part: index });
    const chunk = yield* collectBytes(stream, part.bytes, 4 * 1024 * 1024);
    if (sha256(chunk) !== part.digest) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== ref.bytes) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  return bytes;
});
