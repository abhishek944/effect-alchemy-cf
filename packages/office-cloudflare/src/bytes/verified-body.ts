import type * as cf from "@cloudflare/workers-types";
import { missingContent } from "./data.ts";

// CF may omit the EOF value; DOM readers may include it. Only these actual methods are owned.
type SourceReader<T> = Pick<
  cf.ReadableStreamDefaultReader<T>,
  "cancel" | "closed" | "releaseLock"
> & {
  read(): Promise<{ done: boolean; value?: T | undefined }>;
};

function streamingCrypto(
  value: typeof crypto,
): value is typeof crypto & { DigestStream: typeof cf.DigestStream } {
  return "DigestStream" in value && typeof value.DigestStream === "function";
}

export const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Acquisition failure must join the hash resources before rejecting. */
export function openSource<T>(body: { getReader(): SourceReader<T> }) {
  if (!streamingCrypto(crypto)) throw missingContent();
  const digest = new crypto.DigestStream("SHA-256");
  const hashing = digest.getWriter();
  void digest.digest.catch(() => undefined);
  try {
    return Promise.resolve({ reader: body.getReader(), digest, hashing });
  } catch (cause) {
    return (async () => {
      const cancelled = new Error("Office byte source acquisition failed");
      const results = await Promise.allSettled([
        Promise.resolve().then(() => hashing.abort(cancelled)),
        hashing.closed,
        digest.digest,
      ]);
      const failures = [cause];
      for (const [index, result] of results.entries()) {
        if (result.status === "rejected" && (index === 0 || result.reason !== cancelled))
          failures.push(result.reason);
      }
      try {
        hashing.releaseLock();
      } catch (error) {
        failures.push(error);
      }
      throw new AggregateError(failures, "Office byte source acquisition failed", { cause });
    })();
  }
}

/** EOF is trusted only after exact length/SHA verification AND actual cleanup joins. */
export function verifiedBody(
  body: { getReader(): SourceReader<unknown> },
  bytes: number,
  expectedDigest: string,
): ReadableStream<Uint8Array> {
  const cancelled = new Error("Office byte verification cancelled");
  const failures: unknown[] = [];
  const remember = (cause: unknown): void => {
    if (!failures.includes(cause)) failures.push(cause);
  };
  const observe = (work: Promise<unknown>, expectedAbort = false): Promise<void> =>
    work.then(
      () => undefined,
      (cause: unknown) => {
        if (!expectedAbort || cause !== cancelled) remember(cause);
      },
    );
  let source: Awaited<ReturnType<typeof openSource<unknown>>> | undefined;
  let joins: Promise<void>[] = [];
  const acquiring = openSource(body).then((value) => {
    source = value;
    joins = [
      observe(value.reader.closed),
      observe(value.hashing.closed, true),
      observe(value.digest.digest, true),
    ];
    return value;
  });
  void acquiring.catch(() => undefined);
  let seen = 0;
  let verified = false;
  let stopping = false;
  let cancelledByConsumer = false;
  let working: Promise<Uint8Array | undefined> | undefined;
  let closing: Promise<void> | undefined;
  const close = (reason?: unknown): Promise<void> => {
    if (closing !== undefined) return closing;
    stopping = true;
    // Publish before any cleanup runs, including reentrant/repeated cancellation.
    closing = Promise.resolve().then(async () => {
      await observe(acquiring);
      if (source !== undefined) {
        const { reader, hashing } = source;
        const cancelling = observe(Promise.resolve().then(() => reader.cancel(reason)));
        const aborting = verified
          ? Promise.resolve()
          : observe(Promise.resolve().then(() => hashing.abort(cancelled)));
        await Promise.all([
          cancelling,
          aborting,
          ...joins,
          ...(working === undefined ? [] : [observe(working, true)]),
        ]);
        for (const release of [() => reader.releaseLock(), () => hashing.releaseLock()]) {
          try {
            release();
          } catch (cause) {
            remember(cause);
          }
        }
      }
      if (failures.length !== 0)
        throw new AggregateError(failures, "Office byte verification or cleanup failed", {
          cause: failures[0],
        });
      return undefined;
    });
    void closing.catch(() => undefined);
    return closing;
  };
  const read = async (): Promise<Uint8Array | undefined> => {
    const { reader, hashing, digest } = await acquiring;
    if (stopping) return undefined;
    const part = await reader.read();
    if (stopping) return undefined;
    if (part.done) {
      await hashing.close();
      const actual = hex(await digest.digest);
      if (stopping) return undefined;
      if (seen !== bytes || actual !== expectedDigest) throw missingContent();
      verified = true;
      return undefined;
    }
    if (!(part.value instanceof Uint8Array)) throw missingContent();
    seen += part.value.byteLength;
    if (seen > bytes) throw missingContent();
    await hashing.write(part.value);
    return stopping ? undefined : part.value;
  };
  return new ReadableStream<Uint8Array>(
    {
      start: () =>
        acquiring.then(
          () => undefined,
          (cause: unknown) => {
            remember(cause);
            return close(cause);
          },
        ),
      pull(controller) {
        if (stopping) return closing;
        // Only the actual read/hash operation is joined; never its outer pull/close continuation.
        working = read();
        return working.then(
          async (part) => {
            if (stopping) return undefined;
            if (part !== undefined) controller.enqueue(part);
            else {
              await close();
              if (!cancelledByConsumer) controller.close();
            }
            return undefined;
          },
          (cause: unknown) => {
            if (cause !== cancelled) remember(cause);
            return close(cause);
          },
        );
      },
      cancel(reason: unknown) {
        cancelledByConsumer = true;
        return close(reason);
      },
    },
    { highWaterMark: 0 },
  );
}
