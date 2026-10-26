import { Clock, Effect, Schema } from "effect";
import { Count, Digest, Id, Label, decodeWire } from "@starter/office-contract";
import type { Actor, OfficeDependencies, UploadInput } from "../ports/index.ts";
import { authorize } from "./claims.ts";
import { byteStream, collectBytes } from "./bytes.ts";
import { sha256 } from "./operations.ts";
import { nativeCall, officeFailure } from "./failure.ts";
import { StoredArtifact } from "./record-schemas.ts";

const UploadHeader = Schema.Struct({
  operationId: Id,
  kind: Schema.Literals(["upload", "code"]),
  filename: Label,
  declaredBytes: Count,
  expectedDigest: Schema.NullOr(Digest),
});
const downloadKinds = new Set(["upload", "render", "export"]);
const extensions: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/zip": "zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
};
export const makeOfficeFiles = (deps: OfficeDependencies) => {
  const artifact = Effect.fn("Office.artifact")(function* (actor: Actor, id: string) {
    if (actor.capability !== "human") return yield* Effect.fail(officeFailure("FORBIDDEN"));
    const claims = yield* authorize(deps, actor, "read", null);
    const stored = yield* deps.bytes.get(claims.owner, id);
    if (stored === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
    const ref = yield* decodeWire(StoredArtifact)(stored.ref).pipe(
      Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
    );
    // Native proposals, source code and execution seeds are private service inputs, not public files.
    if (!downloadKinds.has(ref.kind)) {
      yield* nativeCall(() => stored.body.cancel());
      return yield* Effect.fail(officeFailure("FORBIDDEN"));
    }
    return { ref, body: stored.body };
  });
  return {
    upload: Effect.fn("Office.upload")(function* (actor: Actor, input: UploadInput) {
      const header = yield* decodeWire(UploadHeader)({
        operationId: input.operationId,
        kind: input.kind,
        filename: input.filename,
        declaredBytes: input.declaredBytes,
        expectedDigest: input.expectedDigest,
      }).pipe(Effect.mapError(() => officeFailure("INVALID_INPUT")));
      const claims = yield* authorize(deps, actor, "stage", null, header.operationId);
      const maximum =
        header.kind === "code" ? deps.policy.limits.codeBytes : deps.policy.limits.uploadBytes;
      if (header.declaredBytes < 1 || header.declaredBytes > maximum)
        return yield* Effect.fail(officeFailure("LIMIT_EXCEEDED", header.operationId));
      let body = input.body;
      let expectedDigest = header.expectedDigest;
      if (header.kind === "code") {
        const bytes = yield* collectBytes(body, header.declaredBytes, maximum);
        yield* Effect.try({
          try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          catch: () => officeFailure("INVALID_INPUT", header.operationId),
        });
        const digest = sha256(bytes);
        if (expectedDigest !== null && expectedDigest !== digest)
          return yield* Effect.fail(officeFailure("INVALID_INPUT", header.operationId));
        expectedDigest = digest;
        body = byteStream(bytes);
      }
      const ref = yield* deps.bytes.put(claims.owner, {
        id: header.operationId,
        kind: header.kind,
        declaredBytes: header.declaredBytes,
        mediaType: header.kind === "code" ? "text/javascript" : "application/octet-stream",
        expectedDigest,
        body,
      });
      const now = yield* Clock.currentTimeMillis;
      if (claims.expiresAt <= now) return yield* Effect.fail(officeFailure("UNAUTHENTICATED"));
      return yield* decodeWire(StoredArtifact)(ref).pipe(
        Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
      );
    }),
    artifact: (actor: Actor, id: string) =>
      artifact(actor, id).pipe(
        Effect.tap((value) => nativeCall(() => value.body.cancel())),
        Effect.map((value) => value.ref),
      ),
    download: (actor: Actor, id: string) =>
      artifact(actor, id).pipe(
        Effect.map((value) => ({
          ...value,
          filename: `office-${value.ref.id}.${extensions[value.ref.mediaType] ?? "bin"}`,
        })),
      ),
  };
};
