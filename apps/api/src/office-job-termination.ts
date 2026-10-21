import type * as cf from "@cloudflare/workers-types";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import type { officePrivateStream } from "./office-private-stream.ts";

/** Actual teardown joins, not a timeout, abort ACK or empty task map. No exec signal/kill after exit. */
export async function officeTerminateJob(
  native: cf.Container,
  imageRef: string,
  boot: string,
  resources: {
    readonly executing: Promise<cf.ExecProcess> | undefined;
    readonly input: Promise<void> | undefined;
    readonly errors: Promise<void> | undefined;
    readonly monitor: Promise<boolean> | undefined;
    readonly output: ReturnType<typeof officePrivateStream> | undefined;
  },
): Promise<number | null> {
  let failed = false,
    foreign = false;
  try {
    const current = await native.inspect();
    foreign =
      current !== null && (current.image !== imageRef || current.labels["office-job"] !== boot);
    if (foreign) failed = true;
  } catch {
    failed = true;
  }
  // Independently owned box is still destroyed after inspection failure; confirmed foreign is NEVER touched.
  if (!foreign) {
    try {
      await native.destroy();
    } catch {
      failed = true;
    }
  }
  let process: cf.ExecProcess | undefined;
  try {
    process = await resources.executing;
  } catch {
    failed = true;
  }
  const joined = await Promise.allSettled([
    process?.exitCode,
    resources.input,
    resources.errors,
    resources.monitor,
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
  if (failed || joined.some((item) => item.status === "rejected") || !(await resources.monitor))
    throw new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
  return process === undefined ? null : process.exitCode;
}
