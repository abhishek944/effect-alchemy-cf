import {
  diagnosticMetadata,
  reportEvent,
  reportFailure,
  type FailureContext,
} from "@highchat/diagnostics";
import { OfficeUnavailable, safeFailure } from "@highchat/office-contract";
import type { FreshJobPlacement } from "@highchat/office-server/jobs";
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
      const { actor, invocationId, deadline, cleanupDeadline } = original.value;
      const linked = AbortSignal.any([signal, original.signal]);
      const diagnostic = {
        ...diagnosticMetadata(process.env),
        component: "office.job-placement",
        operation: "run",
        release: imageDigest,
        requestId: actor.capability === "draft-task" ? actor.acceptedInput.requestId : undefined,
        taskId: actor.capability === "draft-task" ? actor.acceptedInput.toolTaskId : undefined,
        deadlineAt: deadline,
      };
      let phase = "dispatch",
        began = Date.now(),
        count = 0;
      const enter = (next: string) => {
        phase = next;
        began = Date.now();
        reportEvent({ ...diagnostic, phase, reason: "entered", bytes: count });
      };
      const done = (extra: Partial<FailureContext> = {}) =>
        reportEvent({
          ...diagnostic,
          phase,
          reason: "completed",
          outcome: "confirmed",
          durationMs: Date.now() - began,
          bytes: count,
          ...extra,
        });
      const failed = (cause: unknown) =>
        reportFailure(cause, {
          ...diagnostic,
          event: "application.phase",
          phase,
          reason: "failed",
          outcome: "unknown",
          durationMs: Date.now() - began,
          bytes: count,
        });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let reading: Promise<unknown> | undefined;
      let closed: Promise<unknown> | undefined;
      let cancellation: Promise<unknown> | undefined;
      const cancel = () => {
        const actual = reader;
        if (actual !== undefined)
          cancellation ??= actual.cancel().then(
            () => undefined,
            (cause) => {
              invocations.context.failCleanup(cause, "placement-reader-cancel");
            },
          );
      };
      const abort = () => {
        reportEvent({
          ...diagnostic,
          event: "application.cancelled",
          phase,
          reason: "linked-abort",
          outcome: "cancelled",
          bytes: count,
          durationMs: Date.now() - began,
        });
        cancel();
      };
      linked.addEventListener("abort", abort, { once: true });
      let sent = false,
        completed = false;
      const cleanup = async () => {
        enter("cleanup-read-join");
        cancel();
        await reading;
        done();
        enter("cleanup-close-join");
        await closed;
        done();
        enter("cleanup-cancel-join");
        await cancellation;
        reader?.releaseLock();
        linked.removeEventListener("abort", abort);
        done();
        if (sent && !completed) {
          enter("cleanup-status");
          try {
            await invocations.connection.json(
              `/private/${invocationId}/job-status`,
              { cancel: true },
              NativeJobExit,
              new AbortController().signal,
              cleanupDeadline,
            );
            done();
          } catch (cause) {
            invocations.context.failCleanup(cause, "placement-status-cancel");
            throw unknown();
          }
        }
      };
      try {
        linked.throwIfAborted();
        if (Date.now() >= deadline) throw unknown();
        sent = true;
        enter("dispatch");
        const response = await invocations.connection.request(
          new Request(`${invocations.connection.origin}/private/${invocationId}/job-run`, {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: input.slice().buffer,
            signal: linked,
          }),
        );
        done({ status: response.status });
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
        const chunks: Uint8Array[] = [];
        let empty = 0;
        enter("result-receive");
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
          if (part.value.byteLength === 0 && ++empty > 1024) throw unknown();
          chunks.push(part.value);
          count += part.value.byteLength;
        }
        done();
        enter("result-close-join");
        await closed;
        done();
        enter("result-status");
        const outcome = await invocations.connection.json(
          `/private/${invocationId}/job-status`,
          { cancel: false },
          NativeJobExit,
          new AbortController().signal,
          cleanupDeadline,
        );
        done({ exitCode: outcome.exitCode ?? undefined, step: outcome.status });
        completed = true;
        enter("result-assemble");
        const stdout = new Uint8Array(count);
        let offset = 0;
        for (const chunk of chunks) {
          stdout.set(chunk, offset);
          offset += chunk.byteLength;
        }
        done();
        return { ...outcome, stdout };
      } catch (cause) {
        failed(cause);
        throw cause;
      } finally {
        await cleanup().catch((cause) => {
          failed(cause);
          throw cause;
        });
      }
    },
  };
}
