import type { IncomingMessage } from "node:http";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";

const unavailable = () => new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));

/** Real request body reader. `close` destroys, then joins the ACTUAL pending next() and the genuine
 * close event — a destroy ACK alone is not cleanup. Only usable while the frozen listener still owns
 * the socket; on success the listener's own request/response close joins are the final proof.
 */
export function incomingBody(request: IncomingMessage) {
  const chunks: AsyncIterator<unknown> = request[Symbol.asyncIterator]();
  const closed = new Promise<void>((resolve) => {
    if (request.closed) {
      resolve();
      return;
    }
    request.once("close", resolve);
  });
  let pending: Promise<unknown> | undefined;
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    if (closing !== undefined) return closing;
    closing = Promise.resolve().then(async () => {
      const stopped = Promise.resolve().then(() => chunks.return?.(undefined));
      request.destroy(); // Starts the real close; the pending read and close event prove it.
      const settled = await Promise.allSettled([pending, stopped, closed]);
      if (settled.some((item) => item.status === "rejected")) throw unavailable();
      return undefined;
    });
    return closing;
  }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const actual = chunks.next();
        pending = actual.then(
          () => undefined,
          () => undefined,
        );
        const part = await actual;
        if (part.done) {
          controller.close();
          return;
        }
        if (!(part.value instanceof Uint8Array))
          throw new TypeError("Unexpected office request chunk");
        controller.enqueue(part.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel: close,
  });
  return { stream, close };
}

/** Real download reader. `close` cancels BEFORE joining the pending read + `reader.closed`, then
 * releases the lock. Failures are sticky by settlement status (a rejection is failure even when its
 * reason is `undefined`), so a broken cleanup can never be reported as a complete download.
 */
export function downloadBody(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader();
  const closed = reader.closed.then(
    (): boolean => true,
    (): boolean => false,
  );
  let pending: Promise<unknown> | undefined;
  let cancellation: Promise<unknown> | undefined;
  let closing: Promise<void> | undefined;
  let empty = 0;
  const cancel = () => (cancellation ??= Promise.resolve().then(() => reader.cancel()));
  const abort = () => {
    void cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  async function next(): Promise<ReadableStreamReadResult<Uint8Array>> {
    signal.throwIfAborted();
    const actual = reader.read();
    pending = actual.then(
      () => undefined,
      () => undefined,
    );
    const part = await actual;
    signal.throwIfAborted();
    if (!part.done) {
      if (!(part.value instanceof Uint8Array)) throw unavailable();
      if (part.value.byteLength === 0 && ++empty > 1024) throw unavailable();
    }
    return part;
  }
  async function* chunks(): AsyncGenerator<Uint8Array> {
    for (;;) {
      const part = await next();
      if (part.done) return;
      if (part.value.byteLength > 0) yield part.value;
    }
  }
  function close(): Promise<void> {
    if (closing !== undefined) return closing;
    closing = Promise.resolve().then(async () => {
      const cancelling = cancel(); // Cancel BEFORE joining the real outstanding read.
      const settled = await Promise.allSettled([pending, cancelling, closed]);
      signal.removeEventListener("abort", abort);
      let failed = settled.some((item) => item.status === "rejected");
      if (settled[2].status === "fulfilled" && !settled[2].value) failed = true;
      try {
        reader.releaseLock();
      } catch {
        failed = true;
      }
      if (failed) throw unavailable();
      return undefined;
    });
    return closing;
  }
  return { chunks, close };
}
