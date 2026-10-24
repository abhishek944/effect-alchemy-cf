import type * as cf from "@cloudflare/workers-types";
import { ChatFileIOUnavailable, fileIOUnavailable } from "./chat-file-io-limits.ts";

export type HeldFileBody = {
  readonly body: ReadableStream<Uint8Array>;
  readonly cancel: () => Promise<void>;
  readonly done: Promise<boolean>;
};

/** Validate exact EOF and own actual read/cancel settlement. */
export const holdFileBody = async (
  source: cf.ReadableStream<unknown>,
  expectedBytes: number,
  signal?: AbortSignal,
  observe?: (cause: unknown, phase: "read" | "cleanup") => void,
): Promise<HeldFileBody> => {
  const reader = source.getReader();
  const closed = reader.closed.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  let complete: ((valid: boolean) => void) | undefined;
  const completion = new Promise<boolean>((resolve) => {
    complete = resolve;
  });
  let ended = false;
  let failure: ChatFileIOUnavailable | undefined;
  let readFailure: { cause: unknown } | undefined;
  let stopping: Promise<void> | undefined;
  let reading: Promise<cf.ReadableStreamReadResult<unknown>> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const finish = (valid = false): void => {
    if (ended) return;
    ended = true;
    signal?.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      /* Actual read/cancel already settled. */
    }
    complete?.(valid);
  };
  const stop = (): Promise<void> => {
    if (stopping !== undefined) return stopping;
    if (ended) return Promise.resolve();
    // Publish first, then cancel/join actual IO; never expose an errored wrapper before teardown.
    stopping = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => reader.cancel()),
        reading,
        closed,
      ]);
      finish();
      try {
        controller?.error(failure ?? fileIOUnavailable("storage"));
      } catch {
        /* Already closed. */
      }
      const failures: unknown[] = [];
      for (const result of results) if (result.status === "rejected") failures.push(result.reason);
      const endedSource = await closed;
      if (!endedSource.ok) failures.push(endedSource.error);
      const cleanup = failures.filter((cause) => cause !== readFailure?.cause);
      if (readFailure !== undefined && cleanup.length !== 0 && !signal?.aborted)
        observe?.(new AggregateError(cleanup, "Original file cleanup failed"), "cleanup");
      if (failures.length !== 0)
        throw fileIOUnavailable(
          "storage",
          new AggregateError(failures, "Original file cleanup failed"),
        );
      return undefined;
    });
    return stopping;
  };
  const abort = (): void => {
    // Observer only; stop() retains the same first promise for every actual closer.
    failure ??= fileIOUnavailable("abort");
    void stop().catch(() => undefined);
  };
  try {
    if (signal?.aborted) {
      await stop();
      throw fileIOUnavailable("abort");
    }
    let used = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        start(next) {
          controller = next;
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
        },
        async pull(next) {
          if (ended || stopping !== undefined) return;
          try {
            reading = reader.read();
            const part = await reading;
            if (stopping !== undefined) return;
            if (signal?.aborted) throw fileIOUnavailable("abort");
            if (part.done) {
              if (used !== expectedBytes) throw fileIOUnavailable("integrity");
              next.close();
              finish(true);
              return;
            }
            if (!(part.value instanceof Uint8Array) || part.value.byteLength > expectedBytes - used)
              throw fileIOUnavailable("limit");
            used += part.value.byteLength;
            next.enqueue(part.value);
          } catch (error) {
            const unexpected = stopping === undefined && !signal?.aborted;
            failure =
              error instanceof ChatFileIOUnavailable ? error : fileIOUnavailable("storage", error);
            if (unexpected) {
              readFailure = { cause: error };
              observe?.(failure, "read");
            }
            await stop();
          }
        },
        cancel: () => stop(),
      },
      { highWaterMark: 0 },
    );
    return { body, cancel: stop, done: completion };
  } catch (error) {
    await stop();
    throw error instanceof ChatFileIOUnavailable ? error : fileIOUnavailable("storage", error);
  }
};

/** Fully buffered legacy reader; callers own any later hash/encoding/result lifetime. */
export const collectFileBody = async (body: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value);
      size += part.value.byteLength;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    reader.releaseLock();
  }
};
