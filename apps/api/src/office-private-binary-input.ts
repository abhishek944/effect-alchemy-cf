import { officeBinaryCursor } from "./office-private-frame.ts";
import { officeDenied, type OfficePrivateRequest } from "./office-private-authority.ts";

/** One actual request reader. Framing metadata only; native/file payloads remain opaque. */
export function officeBinaryInput(
  body: ReadableStream<Uint8Array> | null,
  request: OfficePrivateRequest,
) {
  if (body === null) throw officeDenied();
  const cursor = officeBinaryCursor(
    body,
    request.signal,
    request.original.deadline,
    request.charge,
  );
  let pending: Promise<unknown> | undefined, closing: Promise<void> | undefined;
  let resolveDone: (() => void) | undefined, rejectDone: ((error: unknown) => void) | undefined;
  let empty = 0;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  void done.catch(() => undefined);
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing;
    closing = Promise.resolve().then(async () => {
      const cancelling = cursor.close(); // Cancel BEFORE joining the actual outstanding header/read.
      const settled = await Promise.allSettled([pending, cancelling]);
      request.signal.removeEventListener("abort", abort);
      if (settled.some((item) => item.status === "rejected")) throw officeDenied();
      return undefined;
    });
    void closing.then(
      () => resolveDone?.(),
      (error: unknown) => rejectDone?.(error),
    );
    return closing;
  };
  const abort = () => {
    void close().catch(() => undefined);
  };
  const next = async () => {
    const actual = cursor.next();
    pending = actual.then(
      () => undefined,
      () => undefined,
    );
    const part = await actual;
    if (part.done) await close();
    else if (part.value.byteLength === 0 && ++empty > 1024) throw officeDenied();
    return part;
  };
  request.keepIO({ close, drain: () => done }, false); // Own BEFORE parsing/acquiring anything else.
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  return {
    async header() {
      const actual = cursor.header();
      pending = actual.then(
        () => undefined,
        () => undefined,
      );
      return actual;
    },
    async empty() {
      while (true) {
        const part = await next();
        if (part.done) return;
        if (part.value.byteLength !== 0) throw officeDenied();
      }
    },
    async buffer(maximum: number) {
      const bytes = new Uint8Array(maximum);
      let count = 0;
      while (true) {
        const part = await next();
        if (part.done) break;
        if (part.value.byteLength > maximum - count) throw officeDenied();
        bytes.set(part.value, count);
        count += part.value.byteLength;
      }
      if (count === 0) throw officeDenied();
      return bytes.subarray(0, count);
    },
    stream(declaredBytes: number) {
      let bytes = 0;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            await request.live();
            const part = await next();
            await request.live();
            if (part.done) {
              if (bytes !== declaredBytes) throw officeDenied();
              controller.close();
              return;
            }
            bytes += part.value.byteLength;
            if (bytes > declaredBytes) throw officeDenied();
            controller.enqueue(part.value);
          } catch (error) {
            await close();
            controller.error(error);
          }
        },
        cancel: () => close(),
      });
    },
    close,
  };
}
