import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import {
  decodeNativeFrame,
  encodeNativeFrame,
  type NativeFrameKind,
} from "@starter/office-contract/native-wire";
import type { ArtifactRef } from "@starter/office-contract";
import type { OfficeDependencies, OwnerScope } from "../ports/index.ts";
import { nativeCall, nativeFailure, officeFailure } from "./failure.ts";
import { sha256 } from "./operations.ts";

export const byteStream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
export const collectBytes = Effect.fn("Office.collectBytes")(function* (
  stream: ReadableStream<Uint8Array>,
  expected: number,
  maximum: number,
) {
  if (!Number.isSafeInteger(expected) || expected < 0 || expected > maximum)
    return yield* Effect.fail(officeFailure("LIMIT_EXCEEDED"));
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const reader = stream.getReader();
      const abort = () => {
        void reader.cancel().catch(() => undefined);
      };
      signal.addEventListener("abort", abort, { once: true });
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const part = await reader.read();
          signal.throwIfAborted();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > expected || size > maximum) throw officeFailure("LIMIT_EXCEEDED");
          chunks.push(part.value);
        }
      } finally {
        signal.removeEventListener("abort", abort);
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (size !== expected) throw officeFailure("CONTENT_REQUIRED");
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    },
    catch: nativeFailure,
  });
});
export const readArtifact = Effect.fn("Office.readArtifact")(function* (
  deps: OfficeDependencies,
  owner: OwnerScope,
  ref: ArtifactRef,
  maximum: number,
) {
  if (ref.bytes > maximum) return yield* Effect.fail(officeFailure("LIMIT_EXCEEDED"));
  const stored = yield* deps.bytes.get(owner, ref.id);
  if (stored === null) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  if (
    stored.ref.digest !== ref.digest ||
    stored.ref.kind !== ref.kind ||
    stored.ref.bytes !== ref.bytes ||
    stored.ref.mediaType !== ref.mediaType
  ) {
    yield* nativeCall(() => stored.body.cancel());
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  }
  const bytes = yield* collectBytes(stored.body, ref.bytes, maximum);
  if (sha256(bytes) !== ref.digest) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  return bytes;
});
export const stageNativeArtifact = Effect.fn("Office.stageNativeArtifact")(function* (
  deps: OfficeDependencies,
  owner: OwnerScope,
  kind: ArtifactRef["kind"],
  frameKind: NativeFrameKind,
  value: unknown,
  maximum = deps.policy.limits.nativeBytes,
) {
  const bytes = yield* Effect.try({
    try: () => encodeNativeFrame(frameKind, value),
    catch: () => officeFailure("LIMIT_EXCEEDED"),
  });
  if (bytes.byteLength > maximum) return yield* Effect.fail(officeFailure("LIMIT_EXCEEDED"));
  return yield* deps.bytes.put(owner, {
    id: randomUUID(),
    kind,
    mediaType: "application/msgpack",
    declaredBytes: bytes.byteLength,
    expectedDigest: sha256(bytes),
    body: byteStream(bytes),
  });
});
export const loadNativeArtifact = Effect.fn("Office.loadNativeArtifact")(function* (
  deps: OfficeDependencies,
  owner: OwnerScope,
  ref: ArtifactRef,
  kind: NativeFrameKind,
) {
  const bytes = yield* readArtifact(deps, owner, ref, deps.policy.limits.nativeBytes);
  return yield* Effect.try({
    try: () => decodeNativeFrame(bytes, kind).payload,
    catch: () => officeFailure("CONTENT_REQUIRED"),
  });
});
