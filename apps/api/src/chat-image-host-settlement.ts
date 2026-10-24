import type { ImageCallUpdate } from "./chat-image-call-schema.ts";
import { reportFailure } from "@starter/diagnostics";
import type {
  ChatImageHostDependencies,
  ImageHostExecution,
  ImageHostOutcome,
  ImageHostPlan,
} from "./chat-image-host-types.ts";
import { createChatGeneratedClient } from "./chat-generated-client.ts";
import { imageHostToolResult } from "./chat-image-host-result.ts";
import { acknowledgeImageHostOwner } from "./chat-image-host-owner-finalization.ts";
import type { SavedFile } from "./chat-library-schema.ts";
type ReceiptRead = Pick<ImageHostExecution, "plan" | "files" | "client">;
const report = (
  error: unknown,
  operation: string,
  event: "application.cleanup" | "application.failure" | "application.recovery",
  operationId?: string,
): void => reportFailure(error, { component: "chat-image-host", operation, event, operationId });
export const imageHostFiles = (execution: Pick<ImageHostExecution, "files">) =>
  [...execution.files].toSorted(([a], [b]) => a - b).map(([index, file]) => ({ index, file }));
export async function notifyImageHost(execution: ImageHostExecution): Promise<void> {
  try {
    await execution.deps.notify();
  } catch (error) {
    report(error, "notify", "application.recovery", execution.plan.proof.snapshot.operationId);
  }
}

export function recordImageHost(
  execution: ImageHostExecution,
  status: ImageCallUpdate["status"],
  outcome: ImageHostOutcome,
): void {
  execution.deps.calls.record(execution.plan.key, {
    status,
    outcome,
    files: imageHostFiles(execution),
    ...(execution.dispatched && execution.metadata !== undefined
      ? { metadata: execution.metadata }
      : {}),
  });
}

export function rememberImageHostFile(
  execution: ReceiptRead,
  index: number,
  file: SavedFile,
): void {
  const plan = execution.plan;
  const known = execution.files.get(index);
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    file.chatId !== plan.proof.snapshot.chatId ||
    file.origin !== "generated" ||
    file.kind !== "image" ||
    !["ready", "unavailable"].includes(file.state) ||
    file.expiresAt !== null ||
    file.generation?.callId !== plan.key ||
    file.generation.operationId !== plan.proof.operationId ||
    (known !== undefined && known.id !== file.id)
  )
    throw new Error("Stored image receipt identity could not be verified.");
  execution.files.set(index, file);
}

/** Bounded read repair, not a generation count cap. Cursor left over remains unresolved. */
export async function readImageHostReceipts(execution: ReceiptRead): Promise<boolean> {
  let after: number | undefined;
  let unresolved = false;
  for (let page = 0; page < 4; page += 1) {
    const result = await execution.client.receipts(
      { chatId: execution.plan.proof.snapshot.chatId, callId: execution.plan.key },
      after,
    );
    for (const receipt of result.outputs) {
      if (receipt.state === "accepted" && receipt.file !== null)
        rememberImageHostFile(execution, receipt.index, receipt.file);
      else unresolved = true;
    }
    if (result.nextIndex === null) return unresolved;
    if (!Number.isSafeInteger(result.nextIndex) || result.nextIndex <= (after ?? -1))
      throw new Error("Stored image receipt cursor could not be verified.");
    after = result.nextIndex;
  }
  return true;
}

export async function recoverImageHostPlan(deps: ChatImageHostDependencies, plan: ImageHostPlan) {
  const known = deps.calls.read(plan.key);
  const read: ReceiptRead = {
    plan,
    client: createChatGeneratedClient(deps.catalog),
    files: new Map(),
  };
  try {
    await readImageHostReceipts(read);
    if (known?.dispatched && known.status !== "started") {
      deps.calls.record(plan.key, {
        status: known.status === "complete" ? "complete" : "unresolved",
        outcome: known.outcome,
        ...(known.metadata === null ? {} : { metadata: known.metadata }),
        files: imageHostFiles(read),
      });
    }
  } catch (error) {
    // Missing/lost receipts remain uncertain. Do not consume, finish an active owner, or dispatch.
    report(error, "receipt-recovery", "application.failure", plan.proof.snapshot.operationId);
  }
  return imageHostToolResult(
    plan,
    imageHostFiles(read).map(({ file }) => file),
    known?.outcome,
    "Only existing image results were checked. No generation was repeated.",
    known?.status !== "complete",
  );
}

export function failClosedImageHost(
  execution: ImageHostExecution,
  outcome: ImageHostOutcome,
): void {
  try {
    execution.deps.calls.record(execution.plan.key, {
      status: execution.dispatched ? "unresolved" : "failed",
      outcome,
      files: [],
    });
  } catch (error) {
    // Durable failure could not be established. This host cannot grant further paid work.
    execution.blockPaid();
    report(error, "fail-closed", "application.failure", execution.plan.proof.snapshot.operationId);
  }
}

/** No native api is captured: detached writes use only owner/client and local sidecars. */
export function closeImageHost(
  execution: ImageHostExecution,
  outcome: ImageHostOutcome,
  ownerReservationAttempted: boolean,
): void {
  const operationId = execution.plan.proof.snapshot.operationId;
  const work = (async () => {
    try {
      for (const response of execution.responses) {
        if (response.body !== null && !response.body.locked)
          await response.body.cancel().catch((error) => {
            report(error, "cancel", "application.cleanup", operationId);
          });
      }
      await execution.lifetime.drain();
      let unresolved = outcome.storageUncertain;
      await acknowledgeImageHostOwner(execution);
      if (ownerReservationAttempted) {
        try {
          unresolved = await readImageHostReceipts(execution);
        } catch (error) {
          // Preserve earlier honest uncertainty and known receipts when bounded repair fails.
          report(error, "receipt-repair", "application.failure", operationId);
        }
      }
      const current = execution.deps.calls.read(execution.plan.key);
      if (current !== null) {
        execution.dispatched = current.dispatched;
        const complete = current.status === "complete";
        const status = complete
          ? "complete"
          : !current.dispatched || current.status === "failed"
            ? "failed"
            : "unresolved";
        recordImageHost(execution, status, {
          ...outcome,
          dispatched: current.dispatched,
          uncertain: current.dispatched && outcome.uncertain,
          storageUncertain: current.dispatched && unresolved,
          partial:
            current.dispatched &&
            (current.outcome.partial ||
              (!complete && (outcome.partial || execution.files.size > 0))),
        });
      }
      await notifyImageHost(execution);
    } catch (error) {
      report(error, "close", "application.failure", operationId);
      failClosedImageHost(execution, outcome);
    }
  })();
  detachImageHost(execution.deps, work);
}

export function detachImageHost(deps: ChatImageHostDependencies, work: Promise<void>): void {
  const safe = work.catch((error) => report(error, "detached-work", "application.failure"));
  try {
    deps.waitUntil(safe);
  } catch {
    // Already-started bookkeeping remains observed if lifetime registration is unavailable.
    void safe;
  }
}
