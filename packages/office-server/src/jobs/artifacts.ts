import { reportFailure, withCause } from "@starter/diagnostics";
import { Effect } from "effect";
import {
  OfficeInvalid,
  OfficeUnavailable,
  safeFailure,
  type ArtifactRef,
} from "@starter/office-contract";
import type { OfficeBytes, OwnerScope } from "../ports/index.ts";
import { digestBytes } from "./frames.ts";

export const artifactKey = (ref: ArtifactRef): string =>
  JSON.stringify([ref.id, ref.kind, ref.digest, ref.bytes, ref.mediaType]);
/** Materialize only here in Node, after streamed immutable-ref resolution and explicit bounds. */
export const readJobArtifact = Effect.fn("Office.jobs.readArtifact")(function* (
  bytes: OfficeBytes,
  owner: OwnerScope,
  ref: ArtifactRef,
  cap: number,
  cancellation?: AbortSignal,
) {
  if (ref.bytes > cap) return yield* Effect.fail(new OfficeInvalid(safeFailure("LIMIT_EXCEEDED")));
  const found = yield* bytes.get(owner, ref.id);
  if (!found || artifactKey(found.ref) !== artifactKey(ref))
    return yield* Effect.fail(new OfficeInvalid(safeFailure("CONTENT_REQUIRED")));
  return yield* Effect.tryPromise({
    try: async (interrupted) => {
      const signal = cancellation ? AbortSignal.any([interrupted, cancellation]) : interrupted;
      const reader = found.body.getReader();
      let cancelling: Promise<void> | undefined;
      const abort = () => {
        cancelling ??= reader.cancel();
        void cancelling.catch(() => undefined); // Original cancellation is joined below.
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > ref.bytes || size > cap) throw new Error("Artifact length mismatch.");
          chunks.push(part.value);
        }
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.byteLength;
        }
        if (size !== ref.bytes || digestBytes(result) !== ref.digest)
          throw new Error("Artifact identity mismatch.");
        return result;
      } finally {
        signal.removeEventListener("abort", abort);
        abort();
        await cancelling?.catch((cause: unknown) => {
          reportFailure(cause, {
            component: "office.job-supervisor",
            operation: "cancel-artifact",
            event: "application.cleanup",
          });
        });
        reader.releaseLock();
      }
    },
    catch: (cause) => withCause(new OfficeUnavailable(safeFailure("UNAVAILABLE")), cause),
  });
});
export function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
