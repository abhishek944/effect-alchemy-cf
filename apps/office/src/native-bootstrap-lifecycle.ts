import { diagnosticMetadata, reportEvent, reportFailure } from "@starter/diagnostics";

/** Fixed host entry owns boot/shutdown failures; native stdout/stderr are its canonical sinks. */
export async function observeBootstrap(
  run: (enter: (phase: "module" | "bootstrap" | "stopped-notification") => void) => Promise<void>,
) {
  let phase: "module" | "bootstrap" | "stopped-notification" = "bootstrap";
  const started = Date.now();
  const context = {
    ...diagnosticMetadata(process.env),
    component: "office.host-bootstrap",
    operation: "run",
    bootId: process.env["OFFICE_BOOT_ID"],
  };
  // Host stdout is not the job binary stream; use the normal event helper here.
  reportEvent({ ...context, phase: "bootstrap" });
  try {
    await run((next) => {
      phase = next;
      reportEvent({ ...context, phase });
    });
    reportEvent({
      ...context,
      phase: "stopped",
      event: "application.complete",
      outcome: "confirmed",
      durationMs: Date.now() - started,
    });
  } catch (cause) {
    reportFailure(cause, {
      ...context,
      phase,
      reason: "host-bootstrap-failed",
      outcome: "unknown",
      durationMs: Date.now() - started,
    });
    process.exitCode = 1;
  }
}
