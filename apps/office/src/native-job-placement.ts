import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import type { FreshJobPlacement } from "@starter/office-server/jobs";
import { NativeJobExit } from "./native-private-wire.ts";
import type { NativePrivateInvocations } from "./native-private-invocations.ts";

const unknown = () => new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
/** Worker launches a separate fresh box after the genuine first D1 claim ACK. Never exec in this host. */
export function nativeJobPlacement(
  invocations: NativePrivateInvocations,
  imageDigest: string,
): FreshJobPlacement {
  return {
    imageDigest,
    async run(input, signal) {
      const original = invocations.current();
      if (input.byteLength > 64 * 1024 * 1024) throw unknown();
      const { invocationId, deadline, cleanupDeadline } = original.value;
      const linked = AbortSignal.any([signal, original.signal]);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let reading: Promise<unknown> | undefined;
      let closed: Promise<unknown> | undefined;
      let cancellation: Promise<unknown> | undefined;
      const cancel = () => {
        const actual = reader;
        if (actual !== undefined)
          cancellation ??= actual.cancel().then(
            () => undefined,
            () => {
              invocations.context.failCleanup();
            },
          );
      };
      linked.addEventListener("abort", cancel, { once: true });
      let sent = false,
        completed = false;
      const cleanup = async () => {
        cancel();
        await reading;
        await closed;
        await cancellation;
        reader?.releaseLock();
        linked.removeEventListener("abort", cancel);
        if (sent && !completed) {
          try {
            await invocations.connection.json(
              `/private/${invocationId}/job-status`,
              { cancel: true },
              NativeJobExit,
              new AbortController().signal,
              cleanupDeadline,
            );
          } catch {
            invocations.context.failCleanup();
            throw unknown();
          }
        }
      };
      try {
        linked.throwIfAborted();
        if (Date.now() >= deadline) throw unknown();
        sent = true;
        const response = await invocations.connection.request(
          new Request(`${invocations.connection.origin}/private/${invocationId}/job-run`, {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: input.slice().buffer,
            signal: linked,
          }),
        );
        if (
          response.status !== 200 ||
          response.body === null ||
          response.headers.get("content-type") !== "application/octet-stream"
        ) {
          await response.body?.cancel();
          throw unknown();
        }
        reader = response.body.getReader();
        closed = reader.closed.then(
          () => undefined,
          () => undefined,
        );
        if (linked.aborted) cancel();
        const bytes = new Uint8Array(32 * 1024 * 1024);
        let count = 0,
          empty = 0;
        while (true) {
          linked.throwIfAborted();
          if (Date.now() >= deadline) throw unknown();
          const actual = reader.read();
          reading = actual.then(
            () => undefined,
            () => undefined,
          );
          const part = await actual;
          linked.throwIfAborted();
          if (Date.now() >= deadline) throw unknown();
          if (part.done) break;
          if (
            part.value.byteLength > bytes.byteLength - count ||
            (part.value.byteLength === 0 && ++empty > 1024)
          )
            throw unknown();
          bytes.set(part.value, count);
          count += part.value.byteLength;
        }
        await closed;
        const outcome = await invocations.connection.json(
          `/private/${invocationId}/job-status`,
          { cancel: false },
          NativeJobExit,
          new AbortController().signal,
          cleanupDeadline,
        );
        completed = true;
        return { ...outcome, stdout: bytes.slice(0, count) };
      } finally {
        await cleanup();
      }
    },
  };
}
