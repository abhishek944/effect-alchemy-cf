import { invalidBytes, streamFailure } from "./native-stream-failure.ts";
import { watchBytes } from "./native-stream-watch.ts";
export { adapterFailure, invalidBytes } from "./native-stream-failure.ts";
export { watchBytes } from "./native-stream-watch.ts";

export function nativeId(id: string): void {
  const bytes = new TextEncoder().encode(id).byteLength;
  if (bytes < 1 || bytes > 256) throw invalidBytes();
}

/** Use, cancel/pull, derived close and lock release are separate, actually joined outcomes. */
async function consume<A>(
  watched: ReturnType<typeof watchBytes>,
  use: (reader: ReadableStreamDefaultReader<Uint8Array>) => Promise<A>,
): Promise<A> {
  const reader = watched.body.getReader();
  const closed = Promise.allSettled([reader.closed]);
  const result = await Promise.resolve()
    .then(() => use(reader))
    .then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
  const cancelled = await Promise.allSettled([
    Promise.resolve().then(() => watched.cancel("error" in result ? result.error : invalidBytes())),
  ]);
  const ended = await closed;
  const released = await Promise.allSettled([Promise.resolve().then(() => reader.releaseLock())]);
  const errors = [...cancelled, ...ended, ...released]
    .filter((item) => item.status === "rejected")
    .map((item): unknown => item.reason);
  if ("error" in result) throw streamFailure(result.error, errors);
  if (errors.length) throw streamFailure(errors[0], errors.slice(1));
  return result.value;
}

export async function emptyBody(body: ReadableStream<Uint8Array>): Promise<void> {
  const watched = watchBytes(body, 0, 0, null);
  await consume(watched, async (reader) => {
    while (!(await reader.read()).done) {
      /* Zero-length chunks still require real EOF. */
    }
    await watched.done;
  });
}
export async function readBytes(
  source: ReadableStream<Uint8Array>,
  length: number,
  maximum: number,
  digest: string | null,
  owners: Set<{ cancel(reason: unknown): Promise<void> }>,
  check: () => void,
): Promise<Uint8Array> {
  const watched = watchBytes(source, length, maximum, digest);
  owners.add(watched);
  try {
    return await consume(watched, async (reader) => {
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
    });
  } finally {
    owners.delete(watched);
  }
}
