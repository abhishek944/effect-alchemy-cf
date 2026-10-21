import type * as cf from "@cloudflare/workers-types";
import { createChatGeneratedClient } from "./chat-generated-client.ts";
import type { ChatImageCallStore } from "./chat-image-call-store.ts";
import { ImageStorageError } from "./chat-image-storage-schema.ts";
import type { ImageNativeContext } from "./chat-image-request-types.ts";
import type { ImageCallFile } from "./chat-image-call-schema.ts";
import { ChatImageRecoveryDeadline } from "./chat-image-recovery-deadline.ts";

/** Cold reads/finalization only. One shared deadline fences all late local continuations. */
export const recoverChatImageCalls = async (
  calls: ChatImageCallStore,
  catalog: cf.DurableObjectStub | undefined,
  chatId: string,
  context: ImageNativeContext,
): Promise<boolean> => {
  const deadline = new ChatImageRecoveryDeadline(context.abortSignal);
  try {
    return await deadline.wait(async () => {
      let cursor: string | undefined;
      for (let window = 0; window < 32; window += 1) {
        deadline.check();
        const page = calls.unsettled(cursor);
        deadline.check();
        if (page.keys.length > 0 && catalog === undefined) return false;
        if (catalog !== undefined) {
          const client = createChatGeneratedClient(catalog, deadline.signal);
          for (const key of page.keys) {
            deadline.check();
            const known = calls.read(key);
            if (known === null) return false;
            const files: ImageCallFile[] = [];
            let after: number | undefined;
            let pending = false;
            let exhausted = false;
            try {
              for (let index = 0; index < 4; index += 1) {
                const receipts = await deadline.wait(() =>
                  client.receipts({ chatId, callId: key }, after),
                );
                deadline.check();
                for (const receipt of receipts.outputs) {
                  deadline.check();
                  const file = receipt.file;
                  if (receipt.state !== "accepted" || file === null) {
                    pending = true;
                    continue;
                  }
                  if (
                    file.chatId !== chatId ||
                    file.generation?.callId !== key ||
                    file.generation.operationId !== known.admission.operationId
                  )
                    return false;
                  files.push({ index: receipt.index, file });
                }
                if (receipts.nextIndex === null) {
                  exhausted = true;
                  break;
                }
                if (receipts.nextIndex <= (after ?? -1)) return false;
                after = receipts.nextIndex;
              }
              // Cold-start only: never close an actively delivering native tool.
              deadline.check();
              const finished = await deadline.wait(() => client.finish({ chatId, callId: key }));
              deadline.check();
              calls.acknowledgeOwnerFinalization(key);
              deadline.check();
              pending ||= finished.pendingBytes > 0;
            } catch (error) {
              // Timeout/abort is NOT authoritative absence and cannot clear owner pending state.
              deadline.check();
              if (!(error instanceof ImageStorageError) || error.code !== "not_admitted")
                return false;
              calls.acknowledgeOwnerFinalization(key);
              deadline.check();
              exhausted = true;
            }
            deadline.check();
            const metadata = known.metadata;
            const indexes = new Set(files.map((file) => file.index));
            const complete =
              known.dispatched &&
              exhausted &&
              !pending &&
              metadata !== null &&
              metadata.outputs.length > 0 &&
              metadata.outputs.every((output) => indexes.has(output.index));
            deadline.check();
            calls.record(key, {
              status: complete ? "complete" : known.dispatched ? "unresolved" : "failed",
              outcome: {
                dispatched: known.dispatched,
                uncertain: known.dispatched && metadata === null && files.length === 0,
                storageUncertain: known.dispatched && (pending || !exhausted),
                partial: known.dispatched && !complete && files.length > 0,
              },
              ...(metadata === null ? {} : { metadata }),
              files,
            });
            deadline.check();
          }
        }
        deadline.check();
        if (page.nextCursor === null) return true;
        cursor = page.nextCursor;
      }
      return false;
    });
  } catch {
    return false;
  } finally {
    // Closed even on an early return; late real RPC/body settlements stay observed but fenced.
    deadline.close();
  }
};
