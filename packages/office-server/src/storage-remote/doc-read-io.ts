import { withCause } from "@starter/diagnostics";
import { decodeWireSync, Failure, type ErrorCode } from "@starter/office-contract";
import { isOfficeError, officeFailure } from "../core/failure.ts";
import { DOC_READ_LIMITS } from "./read-wire.ts";
type IoOptions = {
  readonly origin: string;
  readonly requestId: string;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly expiresAt: number;
  readonly signal: AbortSignal;
  readonly charge: (bytes: number) => void;
};
const statusErrors: Readonly<Record<number, ErrorCode | undefined>> = {
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  413: "LIMIT_EXCEEDED",
};
/** Private IO only. Association and byte admission are owned by the concrete client. */
export function createDocReadIo(options: IoOptions) {
  const controller = new AbortController(),
    pending = new Set<Promise<unknown>>();
  const managed = new WeakSet<ReadableStream<Uint8Array>>();
  let active = true;
  const cleanupFailures: unknown[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    active = false;
    clearTimeout(timer);
    options.signal.removeEventListener("abort", close);
    controller.abort();
  };
  const check = () => {
    if (!active || options.signal.aborted || Date.now() >= options.expiresAt) {
      close();
      throw officeFailure("AUTHORITY_LOST");
    }
  };
  const expire = () => {
    if (Date.now() >= options.expiresAt) close();
    else {
      timer = setTimeout(expire, Math.min(options.expiresAt - Date.now(), 2_147_483_647));
      timer.unref();
    }
  };
  const wait = async <A>(promise: Promise<A>): Promise<A> => {
    const observed = promise.then(
      (value): PromiseSettledResult<A> => ({ status: "fulfilled", value }),
      (reason: unknown): PromiseSettledResult<A> => ({ status: "rejected", reason }),
    ); // This observer joins actual settlement, independently of the abortable logical wait.
    pending.add(observed);
    void observed.then(() => pending.delete(observed));
    check();
    let abort: (() => void) | undefined;
    const stopped = new Promise<never>((_, reject) => {
      abort = () => reject(officeFailure("AUTHORITY_LOST"));
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    try {
      const result = await Promise.race([observed, stopped]);
      check();
      if (result.status === "rejected") throw result.reason;
      return result.value;
    } finally {
      if (abort) controller.signal.removeEventListener("abort", abort);
    }
  };
  const cleanup = (promise: Promise<unknown>) => {
    const settled = promise.catch((cause: unknown) => {
      cleanupFailures.push(cause);
      close();
    });
    pending.add(settled);
    void settled.then(() => pending.delete(settled));
  };
  const cancel = (body: ReadableStream<Uint8Array> | null | undefined) => {
    if (!body || managed.has(body)) return;
    managed.add(body);
    cleanup(Promise.resolve().then(() => body.cancel()));
  };
  const collect = async (body: ReadableStream<Uint8Array>, maximum: number, prepaid: number) => {
    const reader = body.getReader(),
      chunks: Uint8Array[] = [];
    managed.add(body);
    let size = 0;
    try {
      while (true) {
        const part = await wait(reader.read());
        if (part.done) break;
        const before = Math.max(0, size - prepaid);
        size += part.value.byteLength;
        options.charge(Math.max(0, size - prepaid) - before);
        if (size > maximum) throw officeFailure("LIMIT_EXCEEDED");
        chunks.push(part.value);
      }
    } finally {
      cleanup(
        Promise.resolve()
          .then(() => reader.cancel())
          .finally(() => reader.releaseLock()),
      );
    }
    check();
    if (prepaid && size !== prepaid) throw officeFailure("CONTENT_REQUIRED");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  };
  const perform = async (
    path: "/native-doc/control" | "/native-doc/part",
    text: string,
    maximum: number,
    prepaid: number,
  ) => {
    check();
    const length = new TextEncoder().encode(text).byteLength;
    if (length > DOC_READ_LIMITS.controlBytes) throw officeFailure("LIMIT_EXCEEDED");
    if (!prepaid) options.charge(length);
    const request = new Request(new URL(path, options.origin), {
      method: "POST",
      headers: { "content-type": "application/json", "x-office-read-id": options.requestId },
      body: text,
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    let response: Response | undefined;
    try {
      const value = await wait(
        options.fetch(request).then((result) => {
          response = result;
          if (!active || controller.signal.aborted || Date.now() >= options.expiresAt)
            cancel(result.body);
          return result;
        }),
      );
      if (
        value.redirected ||
        (value.url && value.url !== request.url) ||
        (value.status >= 300 && value.status < 400) ||
        !value.body
      )
        throw officeFailure("UNAVAILABLE");
      const bytes = await collect(
        value.body,
        value.status === 200 ? maximum : DOC_READ_LIMITS.controlBytes,
        value.status === 200 ? prepaid : 0,
      );
      check();
      if (value.status !== 200) {
        let code: ErrorCode;
        try {
          code = decodeWireSync(Failure)(
            JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
          ).code;
        } catch {
          code = statusErrors[value.status] ?? "UNAVAILABLE";
        }
        throw officeFailure(code); // Only validated code is retained, never foreign messages/stacks.
      }
      return bytes;
    } finally {
      cancel(response?.body);
    }
  };
  options.signal.addEventListener("abort", close, { once: true });
  check();
  expire();
  return {
    check,
    close,
    request(
      path: "/native-doc/control" | "/native-doc/part",
      text: string,
      maximum: number,
      prepaid = 0,
    ) {
      const task = perform(path, text, maximum, prepaid).catch((cause) => {
        close();
        throw isOfficeError(cause) ? cause : withCause(officeFailure("UNAVAILABLE"), cause);
      });
      pending.add(task);
      void task.then(
        () => pending.delete(task),
        () => pending.delete(task),
      );
      return task;
    },
    async dispose() {
      close();
      while (pending.size) await Promise.allSettled(pending);
      const cause = new AggregateError(cleanupFailures, "Remote reader cleanup failed");
      if (cleanupFailures.length) throw withCause(officeFailure("UNAVAILABLE"), cause);
    },
  };
}
