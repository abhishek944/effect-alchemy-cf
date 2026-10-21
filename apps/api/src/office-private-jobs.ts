import type * as cf from "@cloudflare/workers-types";
import { decodeWireSync } from "@starter/office-contract";
import { NativeJobExit } from "../../office/src/native-private-wire.ts";
import { officeJobRequest } from "./office-job-request.ts";
import { officeNativeSignal } from "./office-platform.ts";
import { officePrivateStream } from "./office-private-stream.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";
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
  let dispatched = false,
    failed = false;
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
      // Already-owned cleanup observation; it issues NO authority and cannot timeout-as-quiescence.
      const response = await actual.fetch("http://office-job.internal/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancel }),
        redirect: "manual",
      });
      const payload = await readOfficePrivateJson(
        response.body,
        new AbortController().signal,
        null,
        16 * 1024,
      );
      if (response.status !== 200) throw officeDenied();
      const exit = decodeWireSync(NativeJobExit)(payload);
      claims.confirmCleanup(exit); // Actual known private box result, NOT a Node/model claim.
      observed = exit;
      return exit;
    });
    if (cancel) cancellation = result;
    else observation = result;
    void result.catch(() => {
      failed = true;
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
      if (failed || [...joined, ...body].some((item) => item.status === "rejected"))
        throw officeDenied();
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
      if (claim.dispatch === null || claim.dispatch.workerId !== nodeId) throw officeDenied();
      try {
        preparing = officeJobRequest(body, claim, signal, claim.dispatch.deadlineAt, revoke);
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
        starting = stub.fetch("http://office-job.internal/run", {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: input.body,
          // Native Web-IDL signal: the Worker compilation and Node-only infra IDL differ; not auth.
          signal: officeNativeSignal(signal),
          redirect: "manual",
        });
        void starting.catch(() => {
          if (closing === undefined) failed = true;
        });
        const response = await starting;
        if (
          response.status !== 200 ||
          response.body === null ||
          response.headers.get("content-type") !== "application/octet-stream"
        ) {
          responseClosing = response.body?.cancel();
          await responseClosing;
          throw officeDenied();
        }
        output = officePrivateStream(
          response.body,
          32 * 1024 * 1024,
          signal,
          claim.dispatch.deadlineAt,
          async () => {
            await status(false);
          },
          revoke,
        );
        return output.body;
      } catch (error) {
        if (!signal.aborted || error !== signal.reason) failed = true;
        await close();
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
