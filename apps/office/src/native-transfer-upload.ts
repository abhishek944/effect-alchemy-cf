import { OfficeLimited, safeFailure } from "@starter/office-contract";

/** Stream prefix + original bytes once; no tee, native JSON or whole-file collection. */
export function officeBinaryUpload(
  prefix: Uint8Array,
  original: ReadableStream<Uint8Array> | null,
  expected: number,
  signal: AbortSignal,
  deadline: number,
  charge: (bytes: number) => void,
) {
  if (original === null && expected !== 0) throw new Error("Missing binary upload");
  const source =
    original ?? new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
  const reader = source.getReader();
  const closed = reader.closed.then(
    (): { readonly ok: true } => ({ ok: true }),
    (error: unknown): { readonly ok: false; readonly error: unknown } => ({ ok: false, error }),
  );
  let header = false,
    eof = false,
    cancelled = false,
    bytes = 0;
  let pending = Promise.resolve(),
    closing: Promise<void> | undefined;
  let failure: { readonly error: unknown } | undefined;
  const check = () => {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error("Private binary deadline expired");
  };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const actual = Promise.resolve().then(async () => {
        check();
        if (cancelled) return undefined;
        if (!header) {
          charge(prefix.byteLength);
          controller.enqueue(prefix);
          header = true;
          return undefined;
        }
        const part = await reader.read();
        check();
        if (cancelled) return undefined;
        if (part.done) {
          if (bytes !== expected) throw new Error("Incomplete private upload");
          controller.close();
          eof = true;
          return undefined;
        }
        if (!(part.value instanceof Uint8Array)) throw new Error("Invalid private upload chunk");
        bytes += part.value.byteLength;
        if (bytes > expected) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
        const finish = bytes === expected;
        if (finish) {
          let tail = await reader.read();
          check();
          while (!tail.done && tail.value.byteLength === 0) {
            tail = await reader.read();
            check();
          }
          if (cancelled) return undefined;
          if (!tail.done) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
        }
        charge(part.value.byteLength);
        controller.enqueue(part.value);
        if (finish) {
          controller.close();
          eof = true;
        }
        return undefined;
      });
      pending = actual.then(
        () => undefined,
        (error: unknown) => {
          failure ??= { error }; // Joining a rejected pull must never erase its completion outcome.
          return undefined;
        },
      );
      return actual;
    },
    cancel: () => cancel(),
  });
  function cancel(): Promise<void> {
    if (closing !== undefined) return closing;
    cancelled = true;
    closing = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => reader.cancel()),
        pending,
        closed,
      ]);
      reader.releaseLock();
      const cancellation = results[0];
      if (cancellation?.status === "rejected") throw cancellation.reason;
      return undefined;
    });
    return closing;
  }
  return {
    stream,
    cancel,
    async complete(): Promise<void> {
      const result = await closed;
      await pending;
      if (failure !== undefined) throw failure.error;
      if (!result.ok) throw result.error;
      if (!eof || cancelled || bytes !== expected) throw new Error("Private upload EOF unproven");
    },
  };
}
