import type * as cf from "@cloudflare/workers-types";
import type { officeNativeMonitor } from "./office-platform.ts";
import { withCause, withDiagnostic } from "@starter/diagnostics";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";

/** Keep foreign containers intact, and join monitor plus actual Worker callbacks before returning. */
export async function officeContainerCleanup(
  native: cf.Container,
  bootId: string,
  monitor: ReturnType<typeof officeNativeMonitor> | undefined,
  pending: ReadonlySet<Promise<void>>,
  first: () => unknown,
) {
  const failures: unknown[] = [];
  let foreign = false;
  try {
    const current = await native.inspect();
    foreign = current !== null && current.labels["office-boot"] !== bootId;
    if (foreign)
      failures.push(withDiagnostic(new Error("Foreign container"), "foreign-container-retained"));
  } catch (cause) {
    failures.push(
      withCause(withDiagnostic(new Error("Container inspection failed"), "cleanup-inspect"), cause),
    );
  }
  if (!foreign) {
    try {
      await (monitor?.destroy() ?? native.destroy());
    } catch (cause) {
      failures.push(
        withCause(
          withDiagnostic(new Error("Container destruction failed"), "cleanup-destroy"),
          cause,
        ),
      );
    }
  }
  try {
    if (monitor === undefined)
      throw withDiagnostic(new Error("Missing monitor"), "cleanup-monitor-missing");
    await monitor.wait;
  } catch (cause) {
    failures.push(cause);
  }
  while (pending.size > 0) await Promise.all(pending);
  const primary = first();
  if (primary !== undefined && failures.length) failures.unshift(primary);
  if (failures.length)
    throw withCause(
      new OfficeUnavailable(safeFailure("UNAVAILABLE")),
      new AggregateError(failures, "Container cleanup failed"),
    );
}
