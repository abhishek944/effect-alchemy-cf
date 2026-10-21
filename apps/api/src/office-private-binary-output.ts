import { officeBinaryPrefix } from "./office-private-frame.ts";
import { officePrivateStream } from "./office-private-stream.ts";
import { officeDenied, type OfficePrivateRequest } from "./office-private-authority.ts";

/** Real opaque payload reader + outgoing body lease, owned BEFORE header construction/response transfer. */
export function officeBinaryOutput(
  request: OfficePrivateRequest,
  envelope: () => unknown,
  payload: ReadableStream<Uint8Array> | null,
  expected: number,
  inputClose: () => Promise<void>,
  guard: () => Promise<void>,
) {
  const source =
    payload ??
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
  const reader = source.getReader();
  const closed = reader.closed.then(
    () => true,
    () => false,
  );
  let pending: Promise<unknown> | undefined,
    checking: Promise<unknown> | undefined,
    pulling: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let resolveDone: (() => void) | undefined, rejectDone: ((error: unknown) => void) | undefined;
  let revoked = false,
    abortedBody = false,
    eof = false,
    count = 0;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  void done.catch(() => undefined);
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing;
    revoked = true;
    closing = Promise.resolve().then(async () => {
      const cancellation = Promise.resolve().then(() => reader.cancel());
      const results = await Promise.allSettled([pending, checking, pulling, closed, cancellation]);
      let failed = results.some((item) => item.status === "rejected" || item.value === false);
      try {
        reader.releaseLock();
      } catch {
        failed = true;
      }
      if (failed) throw officeDenied();
      return undefined;
    });
    void closing.then(
      () => resolveDone?.(),
      (error: unknown) => rejectDone?.(error),
    );
    return closing;
  };
  request.keepIO({ close, drain: () => done }, false);
  const prefix = officeBinaryPrefix(JSON.stringify(envelope()));
  request.charge(prefix.byteLength);
  const pull = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    try {
      const before = guard();
      checking = before.then(
        () => undefined,
        () => undefined,
      );
      await before;
      if (revoked) throw officeDenied();
      const actual = reader.read();
      pending = actual.then(
        () => undefined,
        () => undefined,
      );
      const part = await actual;
      const after = guard();
      checking = after.then(
        () => undefined,
        () => undefined,
      );
      await after;
      if (revoked) throw officeDenied();
      if (part.done) {
        if (count !== expected) throw officeDenied();
        eof = true;
        controller.close(); // Outer finish owns source closure; do NOT self-await this pull here.
        return;
      }
      if (part.value.byteLength > expected - count) throw officeDenied();
      count += part.value.byteLength;
      request.charge(part.value.byteLength);
      controller.enqueue(part.value);
    } catch (error) {
      controller.error(error);
    }
  };
  const composite = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(prefix);
    },
    pull(controller) {
      const actual = Promise.resolve().then(() => pull(controller));
      pulling = actual;
      return actual;
    },
    cancel: () => {
      abortedBody = true;
      return close();
    },
  });
  const resource = officePrivateStream(
    composite,
    prefix.byteLength + expected,
    request.signal,
    request.original.deadline,
    async () => {
      const result = await Promise.allSettled([close(), inputClose()]);
      if (result.some((item) => item.status === "rejected")) throw officeDenied();
      if (eof && !abortedBody && !request.signal.aborted) await guard();
    },
    () => {
      abortedBody = true;
    },
  );
  request.keepIO(resource, false);
  const response = new Response(resource.body, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "private, no-store",
    },
  });
  return { response, resource };
}
