import type { ImageBoundInput } from "./chat-image-response-schema.ts";
import type {
  GenerationRequestProof,
  ImageNativeAccess,
  ImageNativeContext,
} from "./chat-image-request-types.ts";
import { retainAcceptedOriginals } from "./chat-accepted-input-retention.ts";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";

const unavailable = (): never => {
  throw new Error("Accepted originals could not be retained.");
};

/** Image caller name over the neutral accepted-original retention owner. */
export const retainAcceptedImageInput = (
  access: ImageNativeAccess,
  env: ConversationFileEnv,
  bound: ImageBoundInput,
  context: ImageNativeContext,
): Promise<void> => retainAcceptedOriginals(access, env, bound, context);

/** Exact proven occurrence lookup, not captions or metadata text parsed as authority. */
export const repairImageRequestOriginals = async (
  access: ImageNativeAccess,
  env: ConversationFileEnv,
  proof: GenerationRequestProof,
  context: ImageNativeContext,
): Promise<void> => {
  const repaired = new Set<string>();
  for (const occurrence of proof.inputs) {
    const bound = access.responses.forEntry(
      String(occurrence.originConversationId),
      occurrence.entryId,
      occurrence.modelIndex,
    );
    if (bound === null) return unavailable();
    if (repaired.has(bound.candidate.operationId)) continue;
    await retainAcceptedImageInput(access, env, bound, context);
    repaired.add(bound.candidate.operationId);
  }
};
