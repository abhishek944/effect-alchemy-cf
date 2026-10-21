import type * as cf from "@cloudflare/workers-types";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";
import { decodeWireSync } from "@starter/office-contract";
import type { OwnerScope } from "@starter/office-server/ports";
import { OFFICE_CHAT_TASK_ORIGIN } from "./chat-office-task-http.ts";
import { officeDenied } from "./office-private-authority.ts";
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
    catch: officeDenied,
  });
  return async (owner: OwnerScope, input: OfficeTaskSelector) => {
    const selector = decodeWireSync(OfficeTaskSelector)(input);
    const stub = namespace.getByName(`chat:${owner.ownerId}:${selector.chatId}`);
    const scope = stub.id.toString();
    if (scope !== selector.chatScope) throw officeDenied();
    const deadline = Date.now() + 10_000;
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 10_000);
    try {
      const response = await stub.fetch(`${OFFICE_CHAT_TASK_ORIGIN}/resolve`, {
        method: "POST",
        redirect: "manual",
        signal: officeNativeSignal(stop.signal),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: selector.leaseId }),
      });
      const value = await readOfficePrivateJson(response.body, stop.signal, deadline, 32 * 1024);
      if (response.status !== 200) throw officeDenied();
      const proof = decodeOfficeTaskProof(value);
      const { association, lease } = proof;
      if (
        stop.signal.aborted ||
        Date.now() >= deadline ||
        lease.id !== selector.leaseId ||
        association.chatId !== selector.chatId ||
        association.chatScope !== scope ||
        association.session.ownerId !== owner.ownerId ||
        association.session.stage !== owner.stage ||
        lease.notAfter <= Date.now() ||
        lease.notAfter > association.session.expiresAt
      )
        throw officeDenied();
      return proof;
    } finally {
      clearTimeout(timer);
    }
  };
});
export type OfficeTaskProofReader = Effect.Success<typeof officeTaskProofReader>;
