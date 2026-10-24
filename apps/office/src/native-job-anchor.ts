import { diagnosticMetadata, reportEvent, reportFailure } from "@starter/diagnostics";

/** Fixed PID1 idle role for a FRESH no-egress job box, never the document host.
 * Supervisor still owns destroy and every physical IO join. This role has no job IDs;
 * its native process/container sink must be joined through the supervisor's placement.
 */
const context = {
  ...diagnosticMetadata(process.env),
  component: "office.job-anchor",
  operation: "deadline-guard",
  // Correlation only, supplied by the placement owner; never job/operation authority.
  bootId: process.env["OFFICE_JOB_BOOT_ID"],
};
let deadline: number | undefined;
try {
  const raw = process.env["OFFICE_JOB_DEADLINE"];
  if (raw === undefined || !/^[0-9]{1,16}$/.test(raw))
    throw new Error("Missing original job deadline");
  const parsed = Number(raw);
  if (Number.isSafeInteger(parsed)) deadline = parsed;
  const remaining = parsed - Date.now();
  if (deadline === undefined || remaining <= 0 || remaining > 120_000)
    throw new Error("Invalid original job deadline");
  reportEvent({ ...context, phase: "armed", deadlineAt: deadline });
  const expiry = setTimeout(() => {
    reportFailure(undefined, {
      ...context,
      phase: "expired",
      reason: "job-deadline-expired",
      deadlineAt: deadline,
      exitCode: 124,
      outcome: "unknown",
    });
    process.exit(124);
  }, remaining);
  process.once("SIGTERM", () => {
    clearTimeout(expiry);
    reportEvent({
      ...context,
      phase: "stopped",
      event: "application.complete",
      deadlineAt: deadline,
      exitCode: 0,
      outcome: "cancelled",
    });
    process.exit(0);
  });
} catch (cause) {
  reportFailure(cause, {
    ...context,
    phase: "bootstrap",
    reason: "invalid-job-deadline",
    deadlineAt: deadline,
    exitCode: 1,
    outcome: "unknown",
  });
  process.exitCode = 1;
}
