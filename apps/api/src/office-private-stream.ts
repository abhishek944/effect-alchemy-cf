import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import { officeReadable } from "./office-platform.ts";

const unavailable = () => new OfficeUnavailable(safeFailure("UNAVAILABLE"));
/** Opaque Worker bytes. Source join, owning finish and actual outgoing pull completion are distinct. */
export function officePrivateStream(
  source: unknown,
  maximum: number,
  signal: AbortSignal,
  deadline: number,
  finish: () => Promise<void>,
  revoke: () => void,
) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || !Number.isSafeInteger(deadline))
    throw unavailable();
  const reader = officeReadable(source).getReader();
  const closed = reader.closed.then(
    () => ({ ok: true as const }),
    () => ({ ok: false as const }),
  );
  let count = 0,
    empty = 0,
    ended = false,
    sourceEOF = false,
    fault = false,
    bodyRevoked = false;
  let pending: Promise<unknown> | undefined, pulling: Promise<void> | undefined;
  let cancellation: Promise<boolean> | undefined;
  let sourceJoining: Promise<void> | undefined,
    finishing: Promise<void> | undefined,
    owning: Promise<void> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let resolveDone: (() => void) | undefined, rejectDone: ((error: unknown) => void) | undefined;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  void done.catch(() => undefined);
  const settle = () => {
    if (fault) rejectDone?.(unavailable());
    else resolveDone?.();
  };
  const check = () => {
    signal.throwIfAborted();
    if (owning !== undefined || Date.now() >= deadline) throw unavailable();
  };
  function cancel() {
    if (sourceEOF) return;
    cancellation ??= Promise.resolve()
      .then(() => reader.cancel())
      .then(
        () => true,
        () => false,
      );
  }
  function sourceClosed(cancelSource: boolean): Promise<void> {
    sourceJoining ??= Promise.resolve().then(async () => {
      await pending;
      const outcome = await closed,
        cancelled = await cancellation;
      signal.removeEventListener("abort", abort);
      let failed = !outcome.ok || cancelled === false;
      try {
        reader.releaseLock();
      } catch {
        failed = true;
      }
      if (failed) throw unavailable();
      return undefined;
    });
    if (cancelSource) {
      revoke();
      cancel();
    } // The join promise is installed BEFORE reentry/cancel.
    return sourceJoining;
  }
  function closePhase(cancelSource: boolean): Promise<void> {
    if (finishing !== undefined) {
      if (cancelSource) {
        revoke();
        cancel();
      }
      return finishing;
    }
    finishing = Promise.resolve().then(async () => {
      let failed = false;
      try {
        await sourceClosed(cancelSource);
      } catch {
        failed = true;
      }
      try {
        await finish();
      } catch {
        failed = true;
      }
      if (failed) throw unavailable();
      return undefined;
    });
    return finishing;
  }
  function close(abortBody: boolean = true): Promise<void> {
    if (owning !== undefined) return owning;
    owning = Promise.resolve().then(async () => {
      if (!ended && abortBody) {
        bodyRevoked = true;
        try {
          controller?.error(unavailable());
        } catch {
          fault = true;
        }
      }
      const closures = await Promise.allSettled([closePhase(!ended)]);
      const pulled = await Promise.allSettled([pulling]);
      if (fault || [...closures, ...pulled].some((item) => item.status === "rejected")) {
        fault = true;
        settle();
        throw unavailable();
      }
      settle();
      return undefined;
    });
    return owning;
  }
  function abort() {
    void close().catch(() => undefined);
  }
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const pull = async (outgoing: ReadableStreamDefaultController<Uint8Array>) => {
    let phase: "check" | "read" | "write" = "check";
    try {
      check();
      phase = "read";
      const actual = reader.read();
      pending = actual.then(
        () => undefined,
        () => undefined,
      );
      const part = await actual;
      phase = "check";
      check();
      if (part.done) {
        sourceEOF = true;
        await closePhase(false);
        if (bodyRevoked) {
          settle();
          return;
        }
        phase = "write";
        outgoing.close(); // Successful outgoing EOF only AFTER source/finish AND actual close succeeds.
        ended = true;
        settle();
        return;
      }
      if (!(part.value instanceof Uint8Array)) throw unavailable();
      count += part.value.byteLength;
      if (count > maximum || (part.value.byteLength === 0 && ++empty > 1024)) throw unavailable();
      phase = "write";
      outgoing.enqueue(part.value);
    } catch (error) {
      if (phase === "read" || phase === "write") fault = true; // Includes rejection/throw undefined.
      try {
        await closePhase(true);
      } catch {
        fault = true;
      }
      try {
        outgoing.error(error);
      } catch {
        fault = true;
      }
      settle();
    }
  };
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    pull(value) {
      const actual = Promise.resolve().then(() => pull(value));
      pulling = actual; // Observe/register the ACTUAL outgoing pull before it can enter IO/callbacks.
      return actual;
    },
    cancel: () => close(),
  });
  return {
    body,
    close,
    sourceClosed: () => sourceClosed(!sourceEOF),
    async drain() {
      await done;
      await pulling;
    },
  };
}
