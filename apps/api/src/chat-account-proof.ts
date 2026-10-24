import type { Storage, ToolExecutionApi } from "@earendil-works/pi-durable";
import type { ToolContext } from "./chat-account-resolver.ts";
import { proveNativeLineage, type NativeProof } from "./chat-native-provenance.ts";

export type { NativeProof } from "./chat-native-provenance.ts";

/**
 * Native lineage proof for one executing account tool. Account mutations use the same shared
 * provenance traversal as Office/image, without the tool-call argument checks those need.
 */
export const proveNativeInput = async (
  api: ToolExecutionApi,
  context: ToolContext,
  storage: Storage,
  onDenied?: (reason: string) => void,
): Promise<NativeProof | null> => {
  const proof = await proveNativeLineage(api, context, {
    storage,
    executeCheckpoint: false,
    ...(onDenied === undefined ? {} : { onDenied }),
  });
  if (proof === null) return null;
  return {
    operationId: proof.operationId,
    submissionId: proof.submissionId,
    toolTaskId: proof.toolTaskId,
    generationTaskId: proof.generationTaskId,
    assistantEntryId: proof.assistantEntryId,
  };
};
