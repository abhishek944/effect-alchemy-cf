import { withCause } from "@starter/diagnostics";
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
  let aborting: Promise<PromiseSettledResult<unknown>[]> | undefined;
  const abort = () => {
    aborting ??= Promise.allSettled([
      Promise.resolve().then(() => reader.cancel()),
      Promise.resolve().then(() => hashing.abort()),
      Promise.resolve().then(() => writing?.abort()),
    ]);
  };
  signal.addEventListener("abort", abort, { once: true });
  let bytes = 0;
  let primary: { cause: unknown } | undefined;
  let result: { digest: string; bytes: number } | undefined;
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
    result = { digest: hash, bytes };
  } catch (cause) {
    primary = { cause };
    abort();
  } finally {
    signal.removeEventListener("abort", abort);
  }
  const settled = await Promise.allSettled([Promise.resolve().then(() => reader.cancel())]);
  const aborted = (await aborting) ?? [];
  const released = await Promise.allSettled([
    Promise.resolve().then(() => reader.releaseLock()),
    Promise.resolve().then(() => hashing.releaseLock()),
    Promise.resolve().then(() => writing?.releaseLock()),
  ]);
  const failures = [...settled, ...aborted, ...released]
    .filter((item) => item.status === "rejected")
    .map((item): unknown => item.reason);
  if (failures.length) {
    const cleanup = new AggregateError(failures, "Byte transfer cleanup failed");
    throw primary?.cause instanceof Error
      ? withCause(primary.cause, cleanup)
      : primary === undefined
        ? cleanup
        : new AggregateError([primary.cause, cleanup], "Byte transfer failed");
  }
  if (primary !== undefined) throw primary.cause;
  if (result === undefined) throw missingContent();
  return result;
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
  let cancellation: Promise<void> | undefined;
  const abort = () => {
    controller.abort();
    // A rejected put may never acquire a reader. Abort alone can wait on an in-flight write.
    if (!stream.readable.locked) {
      cancellation ??= stream.readable.cancel();
      void cancellation.catch(() => undefined); // Joined with the original copy/put below.
    }
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
    const settled = await Promise.allSettled([copying, storing, cancellation]);
    const failures = settled
      .filter((item) => item.status === "rejected")
      .map((item): unknown => item.reason);
    const secondary = failures.filter((failure) => failure !== cause);
    if (secondary.length) {
      const cleanup = new AggregateError(secondary, "Byte copy and storage failed");
      throw cause instanceof Error
        ? withCause(cause, cleanup)
        : new AggregateError([cause, cleanup], "Byte storage failed");
    }
    throw cause;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
