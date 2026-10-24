import type { ImageHostExecution } from "./chat-image-host-types.ts";
import { reportFailure } from "@starter/diagnostics";
import { ImageStorageError } from "./chat-image-storage-schema.ts";

/** Finish acknowledgment closes unused capacity, not unresolved owner output-intent holds. */
export async function acknowledgeImageHostOwner(execution: ImageHostExecution): Promise<void> {
  const key = execution.plan.key;
  let acknowledged = false;
  try {
    const result = await execution.client.finish({
      chatId: execution.plan.proof.snapshot.chatId,
      callId: key,
    });
    acknowledged = Number.isSafeInteger(result.pendingBytes) && result.pendingBytes >= 0;
  } catch (error) {
    // Only an authoritative owner response proves absence; timeout/transport errors do not.
    acknowledged = error instanceof ImageStorageError && error.code === "not_admitted";
    if (!acknowledged)
      reportFailure(error, {
        component: "chat-image-host",
        operation: "owner-finalization",
        callId: key,
        event: "application.failure",
      });
  }
  if (acknowledged) execution.deps.calls.acknowledgeOwnerFinalization(key);
}
