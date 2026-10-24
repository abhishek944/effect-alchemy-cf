import { diagnosticMetadata, failureRecord } from "@starter/diagnostics";
import type { decodeJobRequest } from "./transport.ts";

export type JobPhase =
  | "decode"
  | "import"
  | "export"
  | "runtime"
  | "execute"
  | "inspect"
  | "render"
  | "cleanup"
  | "result";
/** Same safe projection as reportEvent, but never its stdout sink: stdout is binary. */
export function jobEvent(
  request: ReturnType<typeof decodeJobRequest> | undefined,
  phase: JobPhase,
  event: "application.phase" | "application.complete" = "application.phase",
  durationMs?: number,
) {
  console.error(
    JSON.stringify({
      ...failureRecord(undefined, {
        ...diagnosticMetadata(process.env),
        component: request === undefined ? "office.job-entry" : "office.job",
        operation: request === undefined ? "run" : "execute",
        phase,
        event,
        durationMs,
        operationId: request?.job.binding.operationId,
        taskId: request?.job.binding.jobId,
        outcome: event === "application.complete" ? "confirmed" : undefined,
      }),
      level: "INFO",
    }),
  );
}
