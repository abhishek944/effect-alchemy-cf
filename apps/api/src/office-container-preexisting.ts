import type * as cf from "@cloudflare/workers-types";
import { withCause, withDiagnostic, type FailureContext } from "@starter/diagnostics";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";

/** The configured Container belongs to this DO, even across a DO restart. Its old
 * process cannot retain the new runtime's private registrations. Stop, never adopt,
 * it before starting a fresh boot; durable storage/uncertain-write fences stay intact. */
export async function stopPreexistingOfficeContainer(
  native: cf.Container,
  imageRef: string,
  event: (phase: string, extra?: Partial<FailureContext>) => void,
): Promise<void> {
  const previous = await native.inspect();
  event("container-preexisting", {
    reason: previous?.image === imageRef ? "same-image" : "previous-image",
  });
  const exited = native.monitor().then(
    () => "stopped" as const,
    () => "failed" as const,
  );
  try {
    await native.destroy();
  } catch (cause) {
    throw withCause(
      withDiagnostic(
        new OfficeUnavailable(safeFailure("UNAVAILABLE")),
        "previous-container-stop-failed",
      ),
      cause,
    );
  }
  const observed = await exited;
  if (native.running || (await native.inspect()) !== null)
    throw withDiagnostic(
      new OfficeUnavailable(safeFailure("UNAVAILABLE")),
      "previous-container-still-running",
    );
  event("container-preexisting-stopped", {
    reason: observed === "failed" ? "previous-process-failed" : "cold-runtime-restart",
    outcome: "confirmed",
  });
}
