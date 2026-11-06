import { OfficeUnavailable, safeFailure } from "@highchat/office-contract";
import { officeReadable } from "./office-platform.ts";

const unavailable = () => new OfficeUnavailable(safeFailure("UNAVAILABLE"));
/** Metadata only. Null deadline is EXCLUSIVELY an already-owned cleanup IO join, never authority. */
export async function readOfficePrivateJson(
  body: unknown,
  signal: AbortSignal,
  deadline: number | null,
  maximum: number | null,
): Promise<unknown> {
  if (
    body === null ||
    (maximum !== null && (!Number.isSafeInteger(maximum) || maximum < 1)) ||
    (deadline !== null && !Number.isSafeInteger(deadline))
  )
    throw unavailable();
  const reader = officeReadable(body).getReader();
  const closed = reader.closed.then(
    () => true,
    () => false,
  );
  const chunks: Uint8Array[] = [];
  let count = 0,
    empty = 0;
  let pending: Promise<unknown> | undefined;
  let cancellation: Promise<boolean> | undefined;
  const cancel = () => {
    cancellation ??= Promise.resolve()
      .then(() => reader.cancel())
      .then(
        () => true,
        () => false,
      );
  };
  const abort = () => {
    cancel();
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const check = () => {
    signal.throwIfAborted();
    if (deadline !== null && Date.now() >= deadline) throw unavailable();
  };
  const cleanup = async () => {
    cancel(); // Initiate real cancellation BEFORE any outstanding read/closed join.
    const results = await Promise.allSettled([pending, closed, cancellation]);
    signal.removeEventListener("abort", abort);
    let failed = results.some((item) => item.status === "rejected" || item.value === false);
    try {
      reader.releaseLock();
    } catch {
      failed = true;
    }
    if (failed) throw unavailable();
    return undefined;
  };
  try {
    while (true) {
      check();
      const actual = reader.read();
      pending = actual.then(
        () => undefined,
        () => undefined,
      );
      const part = await actual;
      check();
      if (part.done) break;
      if (
        !(part.value instanceof Uint8Array) ||
        (maximum !== null && part.value.byteLength > maximum - count) ||
        (part.value.byteLength === 0 && ++empty > 1024)
      )
        throw unavailable();
      chunks.push(part.value);
      count += part.value.byteLength;
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, count)),
    );
  } finally {
    await cleanup();
  }
}
