import type * as cf from "@cloudflare/workers-types";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";
import { diagnosticMetadata, withCause } from "@starter/diagnostics";
import {
  OfficeErrors,
  OfficeUnavailable,
  safeFailure,
  decodeWireSync,
} from "@starter/office-contract";
import type { OwnerScope } from "@starter/office-server/ports";
import { OFFICE_CHAT_TASK_ORIGIN } from "./chat-office-task-http.ts";
import { officeDeny, officeReportBranch } from "./office-diagnostic-report.ts";
import { officeCaught } from "./office-private-authority.ts";
import { officeNativeSignal } from "./office-platform.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";
import { OfficeTaskSelector, decodeOfficeTaskProof } from "./office-task-proof.ts";

type Namespace = Pick<cf.DurableObjectNamespace, "getByName">;
const Namespace = Schema.declare<Namespace>(
  (value): value is Namespace =>
    typeof value === "object" &&
    value !== null &&
    "getByName" in value &&
    typeof value.getByName === "function",
);

/** Capture ACTUAL runtime same-script binding, not a namespace or URL supplied in a request.
 * Shape/IDs correlate only. Original live native closure is proved by the selected conversation.
 * Caller retains/awaits the actual Promise through cancellation; this is not task issuance.
 */
export const officeTaskProofReader = Effect.gen(function* () {
  const env: Readonly<Record<string, unknown>> = yield* Cloudflare.WorkerEnvironment;
  const namespace = yield* Effect.try({
    try: () => decodeWireSync(Namespace)(env.ChatConversation),
    catch: officeCaught,
  });
  return async (owner: OwnerScope, input: OfficeTaskSelector) => {
    const selector = decodeWireSync(OfficeTaskSelector)(input);
    const report = {
      ...diagnosticMetadata(env),
      operation: "proof-callback",
      chatId: selector.chatId,
    };
    const stub = namespace.getByName(`chat:${owner.ownerId}:${selector.chatId}`);
    const scope = stub.id.toString();
    if (scope !== selector.chatScope) throw officeDeny({ ...report, reason: "scope-mismatch" });
    /** Fixed phase label for a rejected transport/read/decode, preserving the first cause. */
    const phase = async <A>(reason: string, work: () => Promise<A>): Promise<A> => {
      try {
        return await work();
      } catch (cause) {
        if (OfficeErrors.some((Type) => cause instanceof Type)) throw cause;
        throw officeReportBranch(
          withCause(new OfficeUnavailable(safeFailure("UNAVAILABLE")), cause),
          { ...report, reason: stop.signal.aborted ? "callback-timeout" : reason },
        );
      }
    };
    const deadline = Date.now() + 10_000;
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 10_000);
    try {
      const response = await phase("callback-transport", () =>
        stub.fetch(`${OFFICE_CHAT_TASK_ORIGIN}/resolve`, {
          method: "POST",
          redirect: "manual",
          signal: officeNativeSignal(stop.signal),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: selector.leaseId }),
        }),
      );
      const value = await phase("callback-body", () =>
        readOfficePrivateJson(response.body, stop.signal, deadline, 32 * 1024),
      );
      if (response.status !== 200) {
        if (response.status === 403 || response.status === 404)
          throw officeDeny({
            ...report,
            reason: "callback-denied",
            status: response.status,
          });
        throw officeReportBranch(new OfficeUnavailable(safeFailure("UNAVAILABLE")), {
          ...report,
          reason: "callback-status",
          status: response.status,
        });
      }
      const proof = await phase("callback-proof-invalid", async () => decodeOfficeTaskProof(value));
      const { association, lease } = proof;
      const ids = {
        operationId: association.intent.operationId,
        taskId: association.acceptedInput.toolTaskId,
        callId: association.callId,
      };
      const deny = (reason: string) => officeDeny({ ...report, ...ids, reason });
      if (stop.signal.aborted || Date.now() >= deadline) throw deny("callback-timeout");
      if (
        lease.id !== selector.leaseId ||
        association.chatId !== selector.chatId ||
        association.chatScope !== scope
      )
        throw deny("callback-lease-mismatch");
      if (
        association.session.ownerId !== owner.ownerId ||
        association.session.stage !== owner.stage
      )
        throw deny("callback-owner-mismatch");
      if (lease.notAfter <= Date.now() || lease.notAfter > association.session.expiresAt)
        throw deny("callback-lease-expired");
      return proof;
    } finally {
      clearTimeout(timer);
    }
  };
});
export type OfficeTaskProofReader = Effect.Success<typeof officeTaskProofReader>;
