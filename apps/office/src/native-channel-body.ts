import { OfficeLimited, safeFailure } from "@starter/office-contract";

/** Finite control/ref-manifest metadata only, NEVER native document, piece or file content. */
export async function readOfficeControlBody(
  response: Response,
  signal: AbortSignal,
  deadline: number,
  charge: (bytes: number) => void,
  cleanupFailed: () => void,
  maximum: number,
): Promise<Uint8Array> {
  if (response.body === null) throw new Error("Missing private control body");
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 2 * 1024 * 1024)
    throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
  // One bounded allocation: arbitrarily fragmented/empty input cannot grow retained-item overhead.
  const output = new Uint8Array(maximum);
  const reader = response.body.getReader();
  const closed = reader.closed.then(
    () => undefined,
    () => undefined,
  );
  let pending = Promise.resolve();
  let cancellation: Promise<PromiseSettledResult<void>> | undefined;
  let bytes = 0,
    empty = 0;
  const cancel = () => {
    if (cancellation !== undefined) return cancellation;
    const actual = Promise.resolve().then(() => reader.cancel());
    cancellation = actual.then(
      (): PromiseFulfilledResult<void> => ({ status: "fulfilled", value: undefined }),
      (reason: unknown): PromiseRejectedResult => {
        cleanupFailed();
        return { status: "rejected", reason };
      },
    );
    return cancellation;
  };
  const abort = () => {
    void cancel();
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const check = () => {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error("Private control deadline expired");
  };
  const read = async () => {
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
      if (!(part.value instanceof Uint8Array)) throw new Error("Invalid private control chunk");
      const size = part.value.byteLength;
      if (size === 0) {
        if (++empty > 1024) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
        continue;
      }
      charge(size);
      if (size > maximum - bytes) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
      output.set(part.value, bytes);
      bytes += size;
    }
    return output.subarray(0, bytes);
  };
  let result: Uint8Array,
    cleanupError = false;
  try {
    result = await read();
  } finally {
    // Start actual cancellation BEFORE joining a possibly stalled read. Ignored cancellation stays pending.
    const cancelling = cancel();
    await Promise.all([pending, closed]);
    const cancelled = await cancelling;
    if (cancelled.status === "rejected") cleanupError = true;
    signal.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      cleanupFailed();
      cleanupError = true;
    }
  }
  if (cleanupError) throw new Error("Private control reader cleanup failed");
  return result;
}
