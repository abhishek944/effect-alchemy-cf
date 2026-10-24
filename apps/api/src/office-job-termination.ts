import {
  withCause,
  withDiagnostic,
  reportFailure,
  reportEvent,
  reportedFailure,
  type FailureContext,
} from "@starter/diagnostics";
import type * as cf from "@cloudflare/workers-types";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import type { officePrivateStream } from "./office-private-stream.ts";
import type { officeNativeMonitor } from "./office-platform.ts";

/** Physical and outgoing joins are distinct; abort output only after its real close join. */
export async function officeFinishJob(
  physical: Promise<void>,
  output: ReturnType<typeof officePrivateStream> | undefined,
  abortBody: boolean,
  stop: AbortController,
  primary: () => unknown,
  context: FailureContext,
) {
  const physicalResult = await Promise.allSettled([physical]);
  reportEvent({ ...context, phase: "output-close", reason: "entered" });
  const streamResult = await Promise.allSettled([output?.close(abortBody)]);
  reportEvent({
    ...context,
    phase: "output-close",
    reason: streamResult[0]?.status === "rejected" ? "failed" : "completed",
    outcome: streamResult[0]?.status === "rejected" ? "unknown" : "confirmed",
  });
  stop.abort();
  const failures = [...physicalResult, ...streamResult]
    .filter((item) => item.status === "rejected")
    .map((item): unknown => item.reason);
  const first = primary();
  if (failures.length) {
    if (first !== undefined) failures.unshift(first);
    const cause = withCause(
      new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN")),
      new AggregateError(failures, "Job cleanup failed"),
    );
    reportFailure(cause, { ...context, operation: "close", phase: "cleanup", outcome: "unknown" });
    throw reportedFailure(cause);
  }
  if (first !== undefined) {
    reportFailure(first, { ...context, phase: "execution", outcome: "unknown" });
    if (first instanceof Error) reportedFailure(first);
  }
  reportEvent({
    ...context,
    operation: "close",
    phase: "closed",
    event: "application.complete",
    outcome: "confirmed",
  });
}

/** Actual teardown joins, not a timeout, abort ACK or empty task map. No exec signal/kill after exit. */
export async function officeTerminateJob(
  native: cf.Container,
  imageRef: string,
  boot: string,
  resources: {
    readonly executing: Promise<cf.ExecProcess> | undefined;
    readonly input: Promise<void> | undefined;
    readonly errors: Promise<void> | undefined;
    readonly monitor: ReturnType<typeof officeNativeMonitor> | undefined;
    readonly output: ReturnType<typeof officePrivateStream> | undefined;
  },
): Promise<number | null> {
  const failures: unknown[] = [];
  let foreign = false;
  try {
    const current = await native.inspect();
    foreign =
      current !== null && (current.image !== imageRef || current.labels["office-job"] !== boot);
    if (foreign)
      failures.push(
        withDiagnostic(new Error("Foreign job container"), "foreign-container-retained"),
      );
  } catch (cause) {
    failures.push(
      withCause(withDiagnostic(new Error("Job inspection failed"), "cleanup-inspect"), cause),
    );
  }
  // Independently owned box is still destroyed after inspection failure; confirmed foreign is NEVER touched.
  if (!foreign) {
    try {
      await (resources.monitor?.destroy() ?? native.destroy());
    } catch (cause) {
      failures.push(
        withCause(withDiagnostic(new Error("Job destruction failed"), "cleanup-destroy"), cause),
      );
    }
  }
  let process: cf.ExecProcess | undefined;
  try {
    process = await resources.executing;
  } catch (cause) {
    failures.push(cause);
  }
  const joined = await Promise.allSettled([
    process?.exitCode,
    resources.input,
    resources.errors,
    resources.monitor?.wait,
    resources.output?.sourceClosed(),
    ...(process?.stdin !== null && process?.stdin !== undefined && !process.stdin.locked
      ? [process.stdin.abort()]
      : []),
    ...(process?.stdout !== null && process?.stdout !== undefined && !process.stdout.locked
      ? [process.stdout.cancel()]
      : []),
    ...(process?.stderr !== null && process?.stderr !== undefined && !process.stderr.locked
      ? [process.stderr.cancel()]
      : []),
  ]);
  failures.push(
    ...joined.filter((item) => item.status === "rejected").map((item): unknown => item.reason),
  );
  if (resources.monitor === undefined)
    failures.push(withDiagnostic(new Error("Job monitor unavailable"), "cleanup-monitor-missing"));
  if (failures.length)
    throw withCause(
      new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN")),
      new AggregateError(failures, "Job teardown failed"),
    );
  return process === undefined ? null : process.exitCode;
}
