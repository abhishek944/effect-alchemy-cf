import { Schema } from "effect";
import { Revision } from "@starter/office-contract";
import type { NativeStorage } from "./native/index.ts";
import { readDocDto, docReadError, waitDocIO } from "./doc-read-io.ts";

const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Settings = Schema.Struct({
  scope: Schema.Struct({ stage: Name, ownerID: Name, documentID: Name, unitID: Name }),
  access: Schema.Struct({ epoch: Revision }),
  ceiling: Revision,
  origin: Schema.String.check(Schema.isMaxLength(2048)),
  requestId: Name,
  expiresAt: Revision,
  budget: Schema.Struct({
    maxCalls: Revision,
    maxBytes: Revision,
    maxValueBytes: Revision.check(Schema.isLessThanOrEqualTo(128 * 1024 * 1024)),
    maxHistoryRevisions: Revision,
  }),
});
/** One original request association. Correlation is not authentication. */
export function createDocReadLifetime(
  options: typeof Settings.Type & {
    readonly native: NativeStorage;
    readonly signal: AbortSignal;
    readonly authorize: () => Promise<void>;
  },
) {
  const { native, signal, authorize, ...input } = options;
  if (
    typeof authorize !== "function" ||
    !signal ||
    typeof signal.addEventListener !== "function" ||
    typeof native?.readInvocation !== "function" ||
    typeof native.readReferences !== "function"
  )
    throw docReadError("INVALID_INPUT");
  let config;
  try {
    config = readDocDto(Settings, structuredClone(input), "INVALID_INPUT");
  } catch {
    throw docReadError("INVALID_INPUT");
  }
  let origin: URL;
  try {
    origin = new URL(config.origin);
  } catch {
    throw docReadError("INVALID_INPUT");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    config.origin !== origin.origin ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw docReadError("INVALID_INPUT");
  Object.freeze(config.scope);
  Object.freeze(config.access);
  Object.freeze(config.budget);
  Object.freeze(config);
  const controller = new AbortController();
  let closed = false,
    calls = 0,
    bytes = 0,
    cleanupFailure = false;
  let tail: Promise<void> = Promise.resolve();
  let closing: Promise<void> | undefined;
  let closeNative: (() => Promise<void>) | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<Promise<unknown>>();
  const responses = new Map<ReadableStreamDefaultController<Uint8Array>, () => void>();
  const track = <T>(work: Promise<T>): Promise<T> => {
    pending.add(work);
    void work.then(
      () => pending.delete(work),
      () => pending.delete(work),
    );
    return work;
  };
  const assertLive = (requestSignal?: AbortSignal) => {
    if (
      closed ||
      signal.aborted ||
      controller.signal.aborted ||
      requestSignal?.aborted ||
      Date.now() >= config.expiresAt
    )
      throw docReadError("FORBIDDEN");
  };
  const check = async (requestSignal?: AbortSignal) => {
    assertLive(requestSignal);
    const authorization = track(
      Promise.resolve().then(async () => {
        assertLive(requestSignal);
        await authorize();
        assertLive(requestSignal);
        return undefined;
      }),
    );
    try {
      await waitDocIO(authorization, controller.signal);
    } catch {
      throw docReadError("FORBIDDEN");
    }
    assertLive(requestSignal);
  };
  const dispose = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    signal.removeEventListener("abort", revoke);
    controller.abort();
    responses.forEach((cleanup, output) => {
      output.error(docReadError("FORBIDDEN"));
      cleanup();
    });
    responses.clear();
    const released = closeNative
      ? closeNative().then(
          () => null,
          () => docReadError("UNAVAILABLE"),
        )
      : Promise.resolve(null);
    closing = (async () => {
      await Promise.allSettled([tail, ...pending]);
      const error = await released;
      if (error || cleanupFailure) throw error ?? docReadError("UNAVAILABLE");
    })();
    return closing;
  };
  // The cached dispose promise still reports cleanup failure to its owner.
  const revoke = () => {
    void dispose().catch(() => undefined);
  };
  const deadline = () => {
    if (closed) return;
    const remaining = config.expiresAt - Date.now();
    if (remaining <= 0) revoke();
    else expiryTimer = setTimeout(deadline, Math.min(remaining, 2_147_483_647));
  };
  signal.addEventListener("abort", revoke, { once: true });
  deadline();
  if (signal.aborted) revoke();
  return Object.freeze({
    config,
    signal: controller.signal,
    assertLive,
    check,
    dispose,
    track,
    cleanupFailed() {
      cleanupFailure = true;
      revoke();
    },
    charge(size: number) {
      if (!Number.isSafeInteger(size) || size < 0 || size > config.budget.maxBytes - bytes)
        throw docReadError("LIMIT_EXCEEDED");
      bytes += size;
    },
    async attach(close: () => Promise<void>) {
      if (closeNative) throw docReadError("FORBIDDEN");
      closeNative = close;
      if (closed) {
        await close();
        throw docReadError("FORBIDDEN");
      }
    },
    enqueue(
      request: Request,
      handle: (cleanup: () => void) => Promise<Response>,
    ): Promise<Response> {
      try {
        if (request.signal.aborted) revoke();
        assertLive(request.signal);
        if (++calls > config.budget.maxCalls) throw docReadError("LIMIT_EXCEEDED");
      } catch (error) {
        return Promise.reject(error);
      }
      request.signal.addEventListener("abort", revoke, { once: true });
      const cleanup = () => request.signal.removeEventListener("abort", revoke);
      const job = tail.then(() => handle(cleanup));
      tail = job.then(
        () => undefined,
        () => undefined,
      );
      return job;
    },
    start(output: ReadableStreamDefaultController<Uint8Array>, cleanup: () => void) {
      assertLive();
      responses.set(output, cleanup);
    },
    end(output: ReadableStreamDefaultController<Uint8Array>) {
      responses.get(output)?.();
      responses.delete(output);
    },
  });
}
export type DocReadLifetime = ReturnType<typeof createDocReadLifetime>;
