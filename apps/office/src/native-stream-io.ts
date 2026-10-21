import { createHash } from "node:crypto";
import { Schema } from "effect";
import {
  OfficeErrors,
  OfficeInvalid,
  OfficeUnavailable,
  decodeWireSync,
  safeFailure,
  type OfficeError,
} from "@starter/office-contract";

export function adapterFailure(cause: unknown): OfficeError {
  return OfficeErrors.some((kind) => cause instanceof kind)
    ? decodeWireSync(Schema.Union(OfficeErrors))(cause)
    : new OfficeUnavailable(safeFailure("UNAVAILABLE"));
}
export const invalidBytes = () => new OfficeInvalid(safeFailure("CONTENT_REQUIRED"));
/** Own the source reader AND derived pull. Cancellation never leaves a consumer read pending. */
export function watchBytes(
  source: ReadableStream<Uint8Array>,
  length: number,
  maximum: number,
  expected: string | null,
) {
  if (
    !Number.isSafeInteger(length) ||
    !Number.isSafeInteger(maximum) ||
    maximum < 0 ||
    length < 0 ||
    length > maximum
  )
    throw invalidBytes();
  const reader = source.getReader(),
    hash = createHash("sha256");
  let completion:
    | { resolve(value: { bytes: number; digest: string }): void; reject(error: unknown): void }
    | undefined;
  const done = new Promise<{ bytes: number; digest: string }>((resolve, reject) => {
    completion = { resolve, reject };
  });
  if (completion === undefined) throw invalidBytes();
  const result = completion;
  void done.catch(() => undefined);
  let bytes = 0,
    closed = false,
    ended = false;
  let output: ReadableStreamDefaultController<Uint8Array> | undefined;
  let sourceStop: Promise<void> | undefined,
    pulling: Promise<void> | undefined,
    cancellation: Promise<void> | undefined;
  function stop(reason: unknown): Promise<void> {
    if (sourceStop !== undefined) return sourceStop;
    if (ended) return Promise.resolve();
    closed = true;
    output?.error(reason);
    sourceStop = Promise.resolve().then(async () => {
      try {
        await reader.cancel(reason);
        reader.releaseLock();
        result.reject(reason);
        return undefined;
      } catch (error) {
        result.reject(error);
        throw error;
      }
    });
    return sourceStop;
  }
  function cancel(reason: unknown): Promise<void> {
    if (cancellation !== undefined) return cancellation;
    const actualStop = stop(reason),
      actualPull = pulling;
    cancellation = Promise.allSettled([
      actualStop,
      ...(actualPull === undefined ? [] : [actualPull]),
    ]).then((results) => {
      for (const item of results) if (item.status === "rejected") throw adapterFailure(item.reason);
      return undefined;
    });
    return cancellation;
  }
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        output = controller;
      },
      pull(controller) {
        pulling = (async () => {
          try {
            const item = await reader.read();
            if (closed) return;
            if (item.done) {
              const digest = hash.digest("hex");
              if (bytes !== length || (expected !== null && expected !== digest))
                throw invalidBytes();
              reader.releaseLock();
              ended = true;
              closed = true;
              result.resolve({ bytes, digest });
              controller.close();
            } else {
              if (!(item.value instanceof Uint8Array)) throw invalidBytes();
              if (item.value.byteLength > length - bytes || item.value.byteLength > maximum - bytes)
                throw invalidBytes();
              const chunk = item.value.slice();
              bytes += chunk.byteLength;
              hash.update(chunk);
              controller.enqueue(chunk);
            }
          } catch (error) {
            await stop(error);
          }
        })();
        return pulling;
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  return { body, done, cancel };
}
export function nativeId(id: string): void {
  const bytes = new TextEncoder().encode(id).byteLength;
  if (bytes < 1 || bytes > 256) throw invalidBytes();
}
export async function emptyBody(body: ReadableStream<Uint8Array>): Promise<void> {
  const watched = watchBytes(body, 0, 0, null),
    reader = watched.body.getReader();
  try {
    while (!(await reader.read()).done) {
      /* Zero-length chunks still require real EOF. */
    }
    await watched.done;
  } finally {
    try {
      await watched.cancel(invalidBytes());
    } finally {
      reader.releaseLock();
    }
  }
}
export async function readBytes(
  source: ReadableStream<Uint8Array>,
  length: number,
  maximum: number,
  digest: string | null,
  owners: Set<{ cancel(reason: unknown): Promise<void> }>,
  check: () => void,
): Promise<Uint8Array> {
  const watched = watchBytes(source, length, maximum, digest),
    reader = watched.body.getReader();
  owners.add(watched);
  try {
    check();
    const bytes = new Uint8Array(length);
    let offset = 0;
    while (true) {
      check();
      const item = await reader.read();
      check();
      if (item.done) break;
      bytes.set(item.value, offset);
      offset += item.value.byteLength;
    }
    await watched.done;
    check();
    return bytes;
  } finally {
    try {
      await watched.cancel(invalidBytes());
    } finally {
      owners.delete(watched);
      reader.releaseLock();
    }
  }
}
