import type * as cf from "@cloudflare/workers-types";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import { withDiagnostic } from "@starter/diagnostics";
import { officeImageReference } from "./office-image.ts";
import { officeJobStreams } from "./office-job-streams.ts";
import { officePrivateStream } from "./office-private-stream.ts";
import { officeNativeSignal } from "./office-platform.ts";
import type { officeLifecycle } from "./office-lifecycle.ts";

export function officeJobContainer(state: cf.DurableObjectState, imageRef: string, stage: string) {
  const native = state.container;
  if (native === undefined || !officeImageReference(imageRef, stage))
    throw withDiagnostic(
      new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN")),
      native === undefined ? "container-not-configured" : "job-image-reference-invalid",
    );
  return native;
}

export async function officeInspectJob(
  native: cf.Container,
  imageRef: string,
  boot: string,
  signal: AbortSignal,
  lifecycle: ReturnType<typeof officeLifecycle>,
) {
  const current = await lifecycle.step("container-inspect", () => native.inspect());
  const reason = signal.aborted
    ? "job-revoked"
    : current === null
      ? "container-absent"
      : current.image !== imageRef
        ? "container-image-mismatch"
        : current.labels["office-job"] !== boot
          ? "container-association-mismatch"
          : undefined;
  if (reason !== undefined)
    throw withDiagnostic(new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN")), reason);
}

export const officeJobStartOptions = (
  boot: string,
  deadline: number,
  stage: string,
  imageRef: string,
) => ({
  enableInternet: false,
  entrypoint: ["node", "/opt/office/dependencies/packages/office-server/native-job-anchor.mjs"],
  env: {
    HOME: "/task",
    TMPDIR: "/tmp",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    OFFICE_JOB_DEADLINE: String(deadline),
    OFFICE_JOB_BOOT_ID: boot, // Diagnostic association only; never checked as authority.
    OBS_SERVICE: "office",
    OBS_STAGE: stage,
    OBS_RELEASE: imageRef.slice(-64), // Caller already validated the actual immutable image reference.
  },
  labels: { "office-job": boot },
  instance: { vcpu: 1, memoryMib: 3072, diskMb: 2048 },
});

export const officeExecuteJob = (
  native: cf.Container,
  signal: AbortSignal,
  stage: string,
  imageRef: string,
) =>
  native.exec(["node", "/opt/office/dependencies/packages/office-server/worker.mjs"], {
    cwd: "/task",
    // Exec does not inherit startup env except PATH; never pass ambient bindings.
    env: {
      HOME: "/task",
      TMPDIR: "/tmp",
      OBS_SERVICE: "office",
      OBS_STAGE: stage,
      OBS_RELEASE: imageRef.slice(-64),
    },
    signal: officeNativeSignal(signal),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

/** IO remains owned by the process lifecycle; EOF cannot self-await its outgoing close. */
export function officeJobExecution(
  process: cf.ExecProcess,
  body: ReadableStream<unknown>,
  signal: AbortSignal,
  deadline: number,
  revoke: () => void,
  binding: { operationId: string; taskId: string },
  lifecycle: ReturnType<typeof officeLifecycle>,
  complete: () => Promise<void>,
) {
  const { event, step } = lifecycle;
  const io = officeJobStreams(
    process,
    body,
    signal,
    deadline,
    revoke,
    binding,
    lifecycle.context(),
  );
  const input = step("stdin", () => io.input);
  const errors = step("stderr", () => io.errors);
  void input.catch(() => undefined);
  void errors.catch(() => undefined);
  // Observe the actual exit immediately, even when stdout is stalled before EOF.
  const exit = step("worker-exit", () => process.exitCode);
  void exit.catch(() => undefined);
  event("stdout", { reason: "entered" });
  const output = officePrivateStream(
    io.stdout,
    32 * 1024 * 1024,
    signal,
    deadline,
    async () => {
      event("stdout-finish", { reason: "entered" });
      const exitCode = await exit;
      event("worker-exit-observed", { outcome: "confirmed", exitCode });
      await Promise.all([input, errors]); // Natural input/stderr drain BEFORE stream revocation.
      await complete();
    },
    revoke,
    { ...lifecycle.context(), operation: "stdout", outcome: "unknown" },
  );
  return { input, errors, output };
}
