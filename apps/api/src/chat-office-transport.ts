import type * as cf from "@cloudflare/workers-types";
import { toRpcAsync } from "alchemy/Cloudflare/Bridge";
import { Schema } from "effect";
import { Count, Id, Receipt, decodeWireSync } from "@starter/office-contract";
import type { OfficeHost } from "./office-host-object.ts";
import { officeHostName } from "./office-host-object.ts";
import { officeDenied } from "./office-private-authority.ts";
import { officeNativeRequest, officeWebResponse } from "./office-platform.ts";
import type { OfficeTaskProof } from "./office-task-proof.ts";

export type OfficeTaskEnvironment = { readonly OfficeHost?: cf.DurableObjectNamespace };
const Issued = Schema.Struct({
  invocationId: Id,
  deadline: Count,
  attachmentReceipt: Schema.NullOr(Receipt),
});
export type OfficeTaskTransport = {
  readonly proof: OfficeTaskProof;
  readonly attachmentReceipt: Receipt | null;
  readonly request: <A>(
    mode: "core" | "upload",
    init: RequestInit,
    observeOnly: boolean,
    consume: (
      response: Response,
      signal: AbortSignal,
      deadline: number,
      invocationId: string,
    ) => Promise<A>,
    onSubmit?: () => void,
  ) => Promise<A>;
};

/** Actual server environment namespace + captured native lease, never a model-selected URL/principal. */
export async function officeTaskTransport(
  env: OfficeTaskEnvironment,
  proof: OfficeTaskProof,
  parent: AbortSignal | undefined,
): Promise<OfficeTaskTransport> {
  if (env.OfficeHost === undefined) throw officeDenied();
  const lease = proof.lease;
  if (lease.notAfter <= Date.now()) throw officeDenied();
  const session = proof.association.session;
  const stub = env.OfficeHost.getByName(
    officeHostName({ stage: session.stage, ownerId: session.ownerId }),
  );
  const rpc = toRpcAsync<OfficeHost>(stub);
  const selector = {
    chatId: proof.association.chatId,
    chatScope: proof.association.chatScope,
    leaseId: lease.id,
  };
  const command = proof.association.intent.command;
  // Staging opens the accepted original BEFORE upload: acquire genuine fresh51 authority first.
  // Receipt fallback obtains a separate observe-only admission if this prepared mode differs.
  const initialObserve = command.command === "operation";
  let prepared: typeof Issued.Type | null = decodeWireSync(Issued)(
    await rpc.registerTask(selector, initialObserve),
  );
  const attachmentReceipt = prepared.attachmentReceipt;
  parent?.throwIfAborted();
  if (
    prepared !== null &&
    (prepared.deadline !== lease.notAfter || prepared.deadline <= Date.now())
  )
    throw officeDenied();
  return {
    proof,
    attachmentReceipt,
    async request<A>(
      mode: "core" | "upload",
      init: RequestInit,
      observeOnly: boolean,
      consume: (
        response: Response,
        signal: AbortSignal,
        deadline: number,
        invocationId: string,
      ) => Promise<A>,
      onSubmit?: () => void,
    ): Promise<A> {
      const stop = new AbortController();
      const signal = parent === undefined ? stop.signal : AbortSignal.any([parent, stop.signal]);
      const timer = setTimeout(() => stop.abort(), Math.max(0, lease.notAfter - Date.now()));
      let response: Response | undefined;
      let result: { value: A } | { error: unknown };
      try {
        signal.throwIfAborted();
        const prior = prepared;
        prepared = null;
        const issued =
          prior !== null && observeOnly === initialObserve
            ? prior
            : decodeWireSync(Issued)(await rpc.registerTask(selector, observeOnly));
        signal.throwIfAborted();
        if (issued.deadline !== lease.notAfter || issued.deadline <= Date.now())
          throw officeDenied();
        const request = new Request(`http://office-api.internal/${mode}/${issued.invocationId}`, {
          ...init,
          method: "POST",
          redirect: "manual",
          signal,
        });
        onSubmit?.();
        response = officeWebResponse(await stub.fetch(officeNativeRequest(request)));
        result = { value: await consume(response, signal, issued.deadline, issued.invocationId) };
      } catch (error) {
        result = { error };
      }
      try {
        if (response?.body !== null && response?.body !== undefined) await response.body.cancel();
      } catch (error) {
        const failures = "error" in result ? [result.error, error] : [error];
        throw new AggregateError(failures, "Office transport cleanup failed", { cause: error });
      } finally {
        clearTimeout(timer);
      }
      if ("error" in result) throw result.error;
      signal.throwIfAborted();
      if (Date.now() >= lease.notAfter) throw officeDenied();
      // The generic result is retained by this exact request's callback, not decoded from metadata.
      return result.value;
    },
  };
}
