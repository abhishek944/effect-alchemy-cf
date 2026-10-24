import type * as cf from "@cloudflare/workers-types";
import { OfficeForbidden, OfficeUnavailable, safeFailure } from "@starter/office-contract";
import { withCause, withDiagnostic } from "@starter/diagnostics";
import { officeLifecycle } from "./office-lifecycle.ts";
import { officeJobResponseError, officeReadJobExit } from "./office-job-response.ts";
import { officeJobRequest } from "./office-job-request.ts";
import { officeNativeSignal } from "./office-platform.ts";
import { officePrivateStream } from "./office-private-stream.ts";
import type { OfficeJobClaims } from "./office-job-claims.ts";
import type { OfficeJobExit } from "./office-job-process.ts";
import type { OfficeNamespace } from "./office-private-bindings.ts";
import { officeDenied, type OfficePrivateRequest } from "./office-private-authority.ts";
/** Real raw same-script fresh instance, selected by original CAS ACK, no retry/adoption/Node host exec. */
export function officePrivateJobs(
  namespace: OfficeNamespace,
  request: OfficePrivateRequest,
  claims: OfficeJobClaims,
  nodeId: string,
) {
  const stop = new AbortController();
  const signal = AbortSignal.any([request.signal, stop.signal]);
  let stub: cf.DurableObjectStub | undefined;
  let dispatched = false;
  let failed: { cause: unknown } | undefined;
  let association:
    | { operationId: string; jobId: string; taskId: string; deadlineAt: number }
    | undefined;
  const { event, step, context } = officeLifecycle(() => ({
    component: "office.private-jobs",
    operation: "dispatch",
    ...association,
  }));
  const upstream = (status: number) => {
    event("upstream-response", { status, outcome: "unknown" });
    return officeJobResponseError(status);
  };
  let starting: Promise<cf.Response> | undefined;
  let preparing: Promise<Awaited<ReturnType<typeof officeJobRequest>>> | undefined;
  let input: Awaited<ReturnType<typeof officeJobRequest>> | undefined;
  let responseClosing: Promise<void> | undefined;
  let output: ReturnType<typeof officePrivateStream> | undefined;
  let observed: OfficeJobExit | undefined;
  let observation: Promise<OfficeJobExit> | undefined;
  let cancellation: Promise<OfficeJobExit> | undefined;
  let closing: Promise<void> | undefined;
  const status = (cancel: boolean): Promise<OfficeJobExit> => {
    if (observed !== undefined) return Promise.resolve(observed);
    if (cancellation !== undefined) return cancellation;
    if (!cancel && observation !== undefined) return observation;
    const actual = stub;
    if (actual === undefined || !dispatched) return Promise.reject(officeDenied());
    const result = Promise.resolve().then(async () => {
      const exit = await step(cancel ? "cancel-status" : "exit-status", () =>
        officeReadJobExit(actual, cancel, event),
      );
      claims.confirmCleanup(exit); // Actual known private box result, NOT a Node/model claim.
      observed = exit;
      return exit;
    });
    if (cancel) cancellation = result;
    else observation = result;
    void result.catch((cause: unknown) => {
      failed ??= { cause };
    });
    return result;
  };
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing;
    closing = Promise.resolve().then(async () => {
      stop.abort();
      const cancellationResult = dispatched ? status(true) : Promise.resolve();
      // Start original cleanup BEFORE joining a possibly stalled exec/body/header response.
      await Promise.allSettled([preparing, starting]);
      const joined = await Promise.allSettled([
        cancellationResult,
        input?.close(),
        output?.sourceClosed(),
        responseClosing,
      ]);
      const body = await Promise.allSettled([output?.close()]);
      const failures = [...joined, ...body]
        .filter((item) => item.status === "rejected")
        .map((item): unknown => item.reason);
      if (failed !== undefined) failures.unshift(failed.cause);
      if (failures.length)
        throw withCause(
          withDiagnostic(
            new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN")),
            "private-job-cleanup",
          ),
          new AggregateError(failures, "Private job cleanup failed"),
        );
      event("cleanup", { outcome: "confirmed" });
      return undefined;
    });
    return closing;
  };
  const revoke = () => {
    void close().catch(() => undefined);
  };
  return {
    async run(body: ReadableStream<Uint8Array>) {
      await request.live();
      if (closing !== undefined) throw officeDenied();
      const claim = claims.take();
      if (claim.dispatch === null || claim.dispatch.workerId !== nodeId)
        throw withDiagnostic(officeDenied(), "job-dispatch-association");
      association = {
        operationId: claim.job.binding.operationId,
        jobId: claim.job.binding.jobId,
        taskId: claim.job.binding.jobId,
        deadlineAt: claim.dispatch.deadlineAt,
      };
      event("claim-taken", { outcome: "confirmed" });
      const deadline = claim.dispatch.deadlineAt;
      try {
        preparing = step("input-prepare", () =>
          officeJobRequest(body, claim, signal, deadline, revoke),
        );
        input = await preparing;
        await request.live();
        if (closing !== undefined) throw officeDenied();
        // Fresh ROLE in same namespace/app image; never the warm document instance.
        stub = namespace.getByName(
          JSON.stringify([
            "office-job",
            claim.owner,
            claim.job.binding.jobId,
            nodeId,
            crypto.randomUUID(),
          ]),
        );
        dispatched = true;
        const actual = stub,
          inputBody = input.body;
        starting = step("job-dispatch", () =>
          actual.fetch("http://office-job.internal/run", {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: inputBody,
            // Native Web-IDL signal: the Worker compilation and Node-only infra IDL differ; not auth.
            signal: officeNativeSignal(signal),
            redirect: "manual",
          }),
        );
        void starting.catch((cause: unknown) => {
          if (closing === undefined) failed ??= { cause };
        });
        const response = await starting;
        if (
          response.status !== 200 ||
          response.body === null ||
          response.headers.get("content-type") !== "application/octet-stream"
        ) {
          const cause = upstream(response.status);
          responseClosing = response.body?.cancel();
          try {
            await responseClosing;
          } catch (cleanup) {
            throw withCause(cause, cleanup);
          }
          throw cause;
        }
        event("output", { reason: "entered" });
        output = officePrivateStream(
          response.body,
          32 * 1024 * 1024,
          signal,
          claim.dispatch.deadlineAt,
          async () => {
            await status(false);
            event("output-finish", { reason: "status-confirmed", outcome: "confirmed" });
          },
          revoke,
          { ...context(), operation: "output", outcome: "unknown" },
        );
        return output.body;
      } catch (error) {
        if (!signal.aborted || error !== signal.reason) failed ??= { cause: error };
        try {
          await close();
        } catch (cleanup) {
          throw withCause(
            error instanceof OfficeForbidden
              ? officeDenied()
              : new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN")),
            new AggregateError([error, cleanup], "Private job failed"),
          );
        }
        throw error;
      }
    },
    status: async (cancel: boolean) => {
      if (cancel) await close();
      return status(cancel);
    },
    close,
  };
}
export type OfficePrivateJobs = ReturnType<typeof officePrivateJobs>;
