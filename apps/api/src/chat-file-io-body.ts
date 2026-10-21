import type * as cf from "@cloudflare/workers-types";
import type { ImageMemoryLease } from "./chat-image-memory.ts";
import { ChatFileIOUnavailable } from "./chat-file-io-memory.ts";

export type HeldFileBody = {
  readonly body: ReadableStream<Uint8Array>;
  readonly cancel: () => Promise<void>;
  readonly done: Promise<boolean>;
};

/** Credit is already claimed. Hold it through exact EOF, or real read/cancel settlement. */
export const holdFileBody = async (
  source: cf.ReadableStream<unknown>,
  expectedBytes: number,
  lease: ImageMemoryLease,
  signal?: AbortSignal,
): Promise<HeldFileBody> => {
  const reader = source.getReader();
  let complete: ((valid: boolean) => void) | undefined;
  const completion = new Promise<boolean>((resolve) => {
    complete = resolve;
  });
  let ended = false;
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
    if (ended) return Promise.resolve();
    stopping ??= (async () => {
      try {
        controller?.error(new ChatFileIOUnavailable());
      } catch {
        /* Already closed. */
      }
      try {
        await reader.cancel();
      } catch {
        /* Still wait for any actual read. */
      }
      await reading?.catch(() => undefined);
      finish();
    })();
    return stopping;
  };
  const abort = (): void => {
    void stop();
  };
  try {
    void lease.track(() => completion).catch(() => undefined);
    if (signal?.aborted) {
      await stop();
      throw new ChatFileIOUnavailable();
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
            if (signal?.aborted) throw new ChatFileIOUnavailable();
            if (part.done) {
              if (used !== expectedBytes) throw new ChatFileIOUnavailable();
              next.close();
              finish(true);
              return;
            }
            if (!(part.value instanceof Uint8Array) || part.value.byteLength > expectedBytes - used)
              throw new ChatFileIOUnavailable();
            used += part.value.byteLength;
            next.enqueue(part.value);
          } catch {
            next.error(new ChatFileIOUnavailable());
            await stop();
          }
        },
        cancel: () => stop(),
      },
      { highWaterMark: 0 },
    );
    return { body, cancel: stop, done: completion };
  } catch {
    await stop();
    throw new ChatFileIOUnavailable();
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
