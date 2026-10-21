import type * as cf from "@cloudflare/workers-types";
import { invalid } from "../metadata/store.ts";
import { missingContent } from "./data.ts";
import { hex, openSource } from "./verified-body.ts";
export { hex, verifiedBody } from "./verified-body.ts";

// Actual Worker constructor; importing its type does not install a runtime implementation.
declare const FixedLengthStream: typeof cf.FixedLengthStream;

/** One source reader, one awaited hash write, one awaited sink write: no independent tee queue. */
export async function transfer(
  body: ReadableStream<Uint8Array>,
  declaredBytes: number,
  signal: AbortSignal,
  sink?: WritableStream<ArrayBuffer | ArrayBufferView>,
): Promise<{ digest: string; bytes: number }> {
  const { reader, digest, hashing } = await openSource<Uint8Array>(body);
  let writing: WritableStreamDefaultWriter<ArrayBuffer | ArrayBufferView> | undefined;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
    void hashing.abort().catch(() => undefined);
    if (writing) void writing.abort().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  let bytes = 0;
  try {
    writing = sink?.getWriter();
    signal.throwIfAborted();
    while (true) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw invalid();
      bytes += part.value.byteLength;
      if (bytes > declaredBytes) throw invalid();
      await hashing.write(part.value);
      if (writing) await writing.write(part.value);
    }
    if (bytes !== declaredBytes) throw invalid();
    await hashing.close();
    const hash = hex(await digest.digest);
    signal.throwIfAborted();
    if (writing) await writing.close();
    return { digest: hash, bytes };
  } catch (cause) {
    abort();
    throw cause;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    hashing.releaseLock();
    writing?.releaseLock();
  }
}

export async function writeObject(
  bucket: cf.R2Bucket,
  key: string,
  input: { body: ReadableStream<Uint8Array>; declaredBytes: number; mediaType: string },
  metadata: Record<string, string>,
  signal: AbortSignal,
): Promise<{ digest: string; bytes: number; etag: string }> {
  const controller = new AbortController();
  const stream = new FixedLengthStream(input.declaredBytes);
  const abort = () => {
    controller.abort();
    // A rejected put may never acquire a reader. Abort alone can wait on an in-flight write.
    if (!stream.readable.locked) void stream.readable.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  const copying = transfer(input.body, input.declaredBytes, controller.signal, stream.writable);
  const storing = Promise.resolve()
    .then(() =>
      bucket.put(key, stream.readable, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: input.mediaType },
        customMetadata: metadata,
      }),
    )
    .then((object) => {
      if (!object || object.size !== input.declaredBytes) throw missingContent();
      return object;
    });
  try {
    signal.throwIfAborted();
    const [verified, object] = await Promise.all([copying, storing]);
    signal.throwIfAborted();
    return { ...verified, etag: object.etag };
  } catch (cause) {
    abort();
    await Promise.allSettled([copying, storing]);
    throw cause;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
