import { withCause, withDiagnostic } from "@starter/diagnostics";
import { officeLifecycle, officeObserve as observe } from "./office-lifecycle.ts";
import { officeNativeMonitor } from "./office-platform.ts";
import type * as cf from "@cloudflare/workers-types";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import type { officePrivateStream } from "./office-private-stream.ts";
import {
  officeJobExecution,
  officeJobStartOptions,
  officeExecuteJob,
  officeJobContainer,
  officeInspectJob,
} from "./office-job-execution.ts";
import { officeTerminateJob, officeFinishJob } from "./office-job-termination.ts";
import type { NativeJobExit } from "../../office/src/native-private-wire.ts";
export type OfficeJobExit = typeof NativeJobExit.Type;
const unavailable = (cause?: unknown) =>
  withCause(new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN")), cause);
/** One fresh private job instance, only AFTER the first original D1 claim ACK. */
export function officeJobProcess(state: cf.DurableObjectState, imageRef: string, stage: string) {
  const native = officeJobContainer(state, imageRef, stage);
  const boot = crypto.randomUUID(),
    stop = new AbortController();
  let used = false,
    owned = false,
    timedOut = false,
    cancelled = false,
    completed = false;
  let binding: { operationId: string; taskId: string } | undefined;
  let deadlineAt: number | undefined;
  const context = () => ({
    component: "office.job-process",
    operation: "run",
    stage,
    service: "office",
    release: imageRef.slice(-64),
    bootId: boot,
    ...binding,
    jobId: binding?.taskId,
    deadlineAt,
  });
  let primary: unknown, terminal: OfficeJobExit | undefined;
  const lifecycle = officeLifecycle(context, (cause) => {
    primary ??= cause;
  });
  const { event, step } = lifecycle;
  let starting: Promise<void> | undefined;
  let executing: Promise<cf.ExecProcess> | undefined;
  let terminating: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let monitor: ReturnType<typeof officeNativeMonitor> | undefined;
  let input: Promise<void> | undefined, errors: Promise<void> | undefined;
  let output: ReturnType<typeof officePrivateStream> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let originalSignal: AbortSignal | undefined;
  let resolveDone: (() => void) | undefined, rejectDone: ((error: unknown) => void) | undefined;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  void done.catch(() => undefined);
  function terminate(): Promise<void> {
    if (terminating !== undefined) return terminating;
    terminating = Promise.resolve().then(async () => {
      if (!completed || cancelled || timedOut) stop.abort();
      clearTimeout(timer);
      originalSignal?.removeEventListener("abort", abort);
      await starting?.catch(() => undefined);
      if (!owned) {
        if (starting === undefined) return undefined;
        throw unavailable();
      }
      const exitCode = await step("cleanup", () =>
        officeTerminateJob(native, imageRef, boot, {
          executing,
          input,
          errors,
          monitor,
          output,
        }),
      );
      terminal = {
        status: timedOut ? "timed-out" : cancelled || !completed ? "cancelled" : "exited",
        exitCode,
        cleanup: "confirmed",
      };
      event("exit", {
        outcome: "confirmed",
        reason: terminal.status,
        exitCode: exitCode ?? undefined,
      });
      return undefined;
    });
    return terminating;
  }
  function close(): Promise<void> {
    if (closing !== undefined) return closing;
    if (!completed) cancelled = true;
    closing = Promise.resolve().then(async () => {
      await officeFinishJob(
        terminate(),
        output,
        cancelled || timedOut || !completed,
        stop,
        () => primary,
        context(),
      );
      return undefined;
    });
    void closing.then(
      () => resolveDone?.(),
      (error: unknown) => rejectDone?.(error),
    );
    return closing;
  }
  const revoke = () => {
    void close().catch(() => undefined);
  };
  const abort = () => {
    event("cancel", { reason: "original-request-aborted", outcome: "unknown" });
    cancelled = true;
    revoke();
  };
  async function run(
    body: ReadableStream<unknown>,
    signal: AbortSignal,
    notAfter: number,
    association: { operationId: string; taskId: string },
  ) {
    if (used || closing !== undefined || signal.aborted)
      throw withDiagnostic(unavailable(), "job-not-live");
    if (!Number.isSafeInteger(notAfter) || notAfter <= Date.now())
      throw withDiagnostic(unavailable(), "job-deadline-expired");
    used = true;
    binding = association;
    const deadline = Math.min(notAfter, Date.now() + 120_000);
    deadlineAt = deadline;
    originalSignal = signal;
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(
      () => {
        timedOut = true;
        primary ??= withDiagnostic(unavailable(), "job-deadline-expired");
        event("deadline", { reason: "job-deadline-expired", outcome: "unknown" });
        revoke();
      },
      Math.max(0, deadline - Date.now()),
    );
    starting = observe(
      step("container-start", () =>
        state.blockConcurrencyWhile(async () => {
          if (native.running) throw withDiagnostic(unavailable(), "container-already-running");
          owned = true;
          native.start(officeJobStartOptions(boot, deadline, stage, imageRef));
          const actual = officeNativeMonitor(native);
          monitor = { ...actual, wait: observe(step("container-monitor", () => actual.wait)) };
        }),
      ),
    );
    try {
      await starting;
      await officeInspectJob(native, imageRef, boot, stop.signal, lifecycle);
      executing = observe(
        step("worker-exec", () => officeExecuteJob(native, stop.signal, stage, imageRef)),
      );
      const process = await executing;
      if (stop.signal.aborted) throw unavailable();
      const io = officeJobExecution(
        process,
        body,
        stop.signal,
        deadline,
        revoke,
        binding,
        lifecycle,
        async () => {
          completed = true;
          await terminate(); // Never await this output's own finish promise.
          revoke();
        },
      );
      ({ input, errors, output } = io);
      return output;
    } catch (error) {
      primary ??= error;
      await close(); // Final close report already retains the first execution cause.
      throw error;
    }
  }
  return {
    run,
    close,
    join: () => done,
    async status() {
      await done;
      if (terminal === undefined) throw unavailable();
      return terminal;
    },
  };
}
