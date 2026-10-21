import { officeImageReference } from "./office-image.ts";
import type * as cf from "@cloudflare/workers-types";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import { officePrivateStream } from "./office-private-stream.ts";
import { officeJobStreams } from "./office-job-streams.ts";
import { officeTerminateJob } from "./office-job-termination.ts";
export type OfficeJobExit = {
  readonly status: "exited" | "cancelled" | "timed-out" | "output-limit";
  readonly exitCode: number | null;
  readonly cleanup: "confirmed";
};
const unavailable = () => new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
const observe = <A>(actual: Promise<A>): Promise<A> => {
  void actual.catch(() => undefined);
  return actual;
};
/** One fresh private job instance, only AFTER the first original D1 claim ACK. */
export function officeJobProcess(state: cf.DurableObjectState, imageRef: string, stage: string) {
  const configured = state.container;
  if (configured === undefined || !officeImageReference(imageRef, stage)) throw unavailable();
  const native = configured;
  const boot = crypto.randomUUID(),
    stop = new AbortController();
  let used = false,
    owned = false,
    timedOut = false,
    cancelled = false,
    completed = false;
  let terminal: OfficeJobExit | undefined;
  let starting: Promise<void> | undefined;
  let executing: Promise<cf.ExecProcess> | undefined;
  let terminating: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let monitor: Promise<boolean> | undefined;
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
      // Normal EOF keeps the output signal live until the real outgoing close join below.
      if (!completed || cancelled || timedOut) stop.abort();
      clearTimeout(timer);
      originalSignal?.removeEventListener("abort", abort);
      await starting?.catch(() => undefined);
      if (!owned) {
        if (starting === undefined) return undefined;
        throw unavailable();
      }
      const exitCode = await officeTerminateJob(native, imageRef, boot, {
        executing,
        input,
        errors,
        monitor,
        output,
      });
      terminal = {
        status: timedOut ? "timed-out" : cancelled || !completed ? "cancelled" : "exited",
        exitCode,
        cleanup: "confirmed",
      };
      return undefined;
    });
    return terminating;
  }
  function close(): Promise<void> {
    if (closing !== undefined) return closing;
    if (!completed) cancelled = true;
    closing = Promise.resolve().then(async () => {
      const physical = await Promise.allSettled([terminate()]);
      const stream = await Promise.allSettled([output?.close(cancelled || timedOut || !completed)]);
      stop.abort(); // Only after the real output-close/EOF join above.
      if ([...physical, ...stream].some((item) => item.status === "rejected")) throw unavailable();
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
    cancelled = true;
    revoke();
  };
  async function run(body: ReadableStream<unknown>, signal: AbortSignal, notAfter: number) {
    if (
      used ||
      closing !== undefined ||
      signal.aborted ||
      !Number.isSafeInteger(notAfter) ||
      notAfter <= Date.now()
    )
      throw unavailable();
    used = true;
    const deadline = Math.min(notAfter, Date.now() + 120_000);
    originalSignal = signal;
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(
      () => {
        timedOut = true;
        revoke();
      },
      Math.max(0, deadline - Date.now()),
    );
    starting = observe(
      Promise.resolve().then(() =>
        state.blockConcurrencyWhile(async () => {
          if (native.running) throw unavailable();
          owned = true;
          native.start({
            enableInternet: false,
            entrypoint: [
              "node",
              "/opt/office/dependencies/packages/office-server/native-job-anchor.mjs",
            ],
            env: {
              HOME: "/task",
              TMPDIR: "/tmp",
              PATH: "/usr/local/bin:/usr/bin:/bin",
              OFFICE_JOB_DEADLINE: String(deadline),
            },
            labels: { "office-job": boot },
            instance: { vcpu: 1, memoryMib: 3072, diskMb: 2048 },
          });
          monitor = native.monitor().then(
            () => true,
            () => false,
          );
        }),
      ),
    );
    try {
      await starting;
      const inspected = await native.inspect();
      if (
        stop.signal.aborted ||
        inspected?.image !== imageRef ||
        inspected.labels["office-job"] !== boot
      )
        throw unavailable();
      // Destroy owns termination; never attach an abort signal that can kill exec AFTER confirmed exit.
      executing = observe(
        native.exec(["node", "/opt/office/dependencies/packages/office-server/worker.mjs"], {
          cwd: "/task",
          env: {},
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const process = await executing;
      if (stop.signal.aborted) throw unavailable();
      const io = officeJobStreams(process, body, stop.signal, deadline, revoke);
      input = observe(io.input);
      errors = observe(io.errors);
      output = officePrivateStream(
        io.stdout,
        32 * 1024 * 1024,
        stop.signal,
        deadline,
        async () => {
          await process.exitCode;
          await Promise.all([input, errors]); // Natural stdin/stderr drain BEFORE stream revocation.
          completed = true;
          await terminate(); // Source-only join: MUST NOT await this output's own finish promise.
          revoke(); // Publish the separate complete body/finish join without self-await.
        },
        revoke,
      );
      return output;
    } catch (error) {
      await close();
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
