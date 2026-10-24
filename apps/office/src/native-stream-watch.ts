import { createHash } from "node:crypto";
import { invalidBytes, streamFailure } from "./native-stream-failure.ts";

/** Own the source reader AND derived pull. Cancellation joins both before returning. */
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
  const sourceClosed = Promise.allSettled([reader.closed]);
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
  let failure: { error: unknown } | undefined;
  let output: ReadableStreamDefaultController<Uint8Array> | undefined;
  let sourceStop: Promise<void> | undefined,
    pulling: Promise<void> | undefined,
    cancellation: Promise<void> | undefined;
  function stop(reason: unknown): Promise<void> {
    if (sourceStop !== undefined) return sourceStop;
    if (ended) return Promise.resolve();
    closed = true;
    failure = { error: reason };
    output?.error(reason);
    sourceStop = Promise.resolve().then(async () => {
      const cancelled = await Promise.allSettled([
        Promise.resolve().then(() => reader.cancel(reason)),
      ]);
      const endedSource = await sourceClosed;
      const released = await Promise.allSettled([
        Promise.resolve().then(() => reader.releaseLock()),
      ]);
      const errors = [...cancelled, ...endedSource, ...released]
        .filter((item) => item.status === "rejected")
        .map((item): unknown => item.reason);
      const error = streamFailure(reason, errors);
      failure = { error };
      result.reject(error);
      if (errors.some((secondary) => secondary !== reason)) throw error;
      return undefined;
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
      const errors = results
        .filter((item) => item.status === "rejected")
        .map((item): unknown => item.reason);
      if (errors.length)
        throw streamFailure(failure === undefined ? reason : failure.error, errors);
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
