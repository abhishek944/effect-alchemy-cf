import type { FailureContext } from "@starter/diagnostics";
import { officeReadable } from "./office-platform.ts";
import {
  officeStreamFailures,
  officeStreamCompletion,
  officeStreamFinish,
  officeStreamUnavailable as unavailable,
} from "./office-stream-failure.ts";
/** Opaque Worker bytes. Source join, owning finish and actual outgoing pull completion are distinct. */
export function officePrivateStream(
  source: unknown,
  maximum: number,
  signal: AbortSignal,
  deadline: number,
  finish: () => Promise<void>,
  revoke: () => void,
  context?: FailureContext,
) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || !Number.isSafeInteger(deadline))
    throw unavailable("transfer-configuration");
  const failures = officeStreamFailures();
  const reader = officeReadable(source).getReader();
  const closed = failures.observe(reader.closed, "source-closed");
  let count = 0,
    empty = 0,
    ended = false,
    sourceEOF = false,
    fault = false,
    bodyRevoked = false;
  let pending: Promise<unknown> | undefined, pulling: Promise<void> | undefined;
  let cancellation: ReturnType<typeof failures.observe> | undefined;
  let sourceJoining: Promise<void> | undefined,
    finishing: Promise<void> | undefined,
    owning: Promise<void> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const completion = officeStreamCompletion(
    failures,
    () => pulling,
    context,
    () => ({
      bytes: count,
      sourceEOF,
      ended,
      revoked: bodyRevoked,
      aborted: signal.aborted,
      deadlineAt: deadline,
    }),
  );
  const settle = () => completion.settle(fault);
  const check = () => {
    signal.throwIfAborted();
    if (owning !== undefined || Date.now() >= deadline)
      throw unavailable(owning !== undefined ? "transfer-revoked" : "transfer-deadline");
  };
  function cancel() {
    if (sourceEOF) return;
    cancellation ??= failures.observe(
      Promise.resolve().then(() => reader.cancel()),
      "source-cancel",
    );
  }
  function sourceClosed(cancelSource: boolean): Promise<void> {
    sourceJoining ??= Promise.resolve().then(async () => {
      await pending;
      const outcome = await closed,
        cancelled = await cancellation;
      signal.removeEventListener("abort", abort);
      let failed = !outcome.ok || cancelled?.ok === false;
      try {
        reader.releaseLock();
      } catch (cause) {
        failures.capture(cause, "source-release");
        failed = true;
      }
      if (failed) throw failures.error();
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
    finishing = Promise.resolve().then(() =>
      officeStreamFinish(() => sourceClosed(cancelSource), finish, failures),
    );
    return finishing;
  }
  function close(abortBody: boolean = true): Promise<void> {
    if (owning !== undefined) return owning;
    owning = Promise.resolve().then(async () => {
      if (!ended && abortBody) {
        bodyRevoked = true;
        try {
          controller?.error(
            failures.failed
              ? failures.error()
              : unavailable("outgoing-revoked", signal.aborted ? signal.reason : undefined),
          );
        } catch (cause) {
          failures.capture(cause, "outgoing-error");
          fault = true;
        }
      }
      const closures = await Promise.allSettled([closePhase(!ended)]);
      const pulled = await Promise.allSettled([pulling]);
      for (const item of [...closures, ...pulled])
        if (item.status === "rejected") failures.capture(item.reason, "outgoing-join");
      if (fault || [...closures, ...pulled].some((item) => item.status === "rejected")) {
        fault = true;
        settle();
        throw failures.error();
      }
      settle();
      return undefined;
    });
    return owning;
  }
  function abort() {
    failures.capture(signal.reason, "transfer-abort");
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
      pending = failures.observe(actual, "source-read");
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
      if (!(part.value instanceof Uint8Array)) throw unavailable("transfer-chunk-type");
      count += part.value.byteLength;
      if (count > maximum || (part.value.byteLength === 0 && ++empty > 1024))
        throw unavailable("transfer-byte-bound");
      phase = "write";
      outgoing.enqueue(part.value);
    } catch (error) {
      failures.capture(
        error,
        phase === "read" ? "source-read" : phase === "write" ? "outgoing-write" : "transfer-check",
      );
      if (phase === "read" || phase === "write") fault = true; // Includes rejection/throw undefined.
      try {
        await closePhase(true);
      } catch (cause) {
        failures.capture(cause, "transfer-close");
        fault = true;
      }
      try {
        outgoing.error(error);
      } catch (cause) {
        failures.capture(cause, "outgoing-error");
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
    drain: () => completion.drain(),
  };
}
