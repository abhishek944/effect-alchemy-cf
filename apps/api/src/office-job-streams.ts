import type * as cf from "@cloudflare/workers-types";
import { reportFailure, type FailureContext } from "@starter/diagnostics";
import { jobDiagnostics, OfficeUnavailable, safeFailure } from "@starter/office-contract";
import { officePrivateStream } from "./office-private-stream.ts";

/** The fresh job owns stdin/stderr transfers; stdout stays streamed to its original consumer. */
export function officeJobStreams(
  process: cf.ExecProcess,
  body: ReadableStream<unknown>,
  signal: AbortSignal,
  deadline: number,
  revoke: () => void,
  binding: { operationId: string; taskId: string },
  context?: FailureContext,
) {
  const diagnostic: FailureContext = {
    service: context?.service,
    stage: context?.stage,
    release: context?.release,
    requestId: context?.requestId,
    bootId: context?.bootId,
    jobId: context?.jobId,
    callId: context?.callId,
    component: "office.job-supervisor",
    operation: "transfer",
    phase: "transfer",
    outcome: "unknown",
    operationId: binding.operationId,
    taskId: binding.taskId,
  };
  if (process.stdin === null || process.stdout === null || process.stderr === null)
    throw new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
  const incoming = officePrivateStream(
    body,
    64 * 1024 * 1024,
    signal,
    deadline,
    () => Promise.resolve(),
    revoke,
    { ...diagnostic, operation: "stdin" },
  );
  const stderr = officePrivateStream(
    process.stderr,
    64 * 1024,
    signal,
    deadline,
    () => Promise.resolve(),
    revoke,
    { ...diagnostic, operation: "stderr" },
  );
  return {
    input: incoming.body.pipeTo(process.stdin),
    errors: (async () => {
      const reader = stderr.body.getReader();
      const relay = jobDiagnostics(undefined, binding);
      const failures: unknown[] = [];
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          for (const record of relay.write(part.value)) {
            const line = JSON.stringify(record);
            if (record.level === "INFO") console.log(line);
            else console.error(line);
          }
        }
      } catch (cause) {
        failures.push(cause); // Transfer terminal/process owners report the actual cause.
      }
      try {
        const { discarded } = relay.finish();
        if (discarded)
          reportFailure(undefined, {
            ...diagnostic,
            operation: "stderr",
            phase: "stderr-relay",
            reason: "unstructured-diagnostic",
            event: "application.failure",
            level: "ERROR",
          });
      } catch (cause) {
        failures.push(cause);
      }
      try {
        reader.releaseLock();
      } catch (cause) {
        failures.push(cause);
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Job stderr relay failed");
    })(),
    stdout: process.stdout,
  };
}
