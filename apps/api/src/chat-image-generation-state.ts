import type { Api, Model } from "@earendil-works/pi-ai";
import { installedChatModel } from "./chat-capability-catalog.ts";
import { readImageRequestState } from "./chat-image-request-state.ts";
import { sameImageRequestValue } from "./chat-image-request-values.ts";
import type {
  GenerationRequestTicketProof,
  ImageNativeContext,
  ImageRequestAccess,
} from "./chat-image-request-types.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";

export const IMAGE_GENERATION_INCOMPLETE =
  "Request verification or original reading failed; this answer is incomplete.";
const invalid = (): never => {
  throw new Error(IMAGE_GENERATION_INCOMPLETE);
};

/** Actual Models runtime.signal is mandatory; factory/background signals never replace it. */
export const imageGenerationContext = (
  context: ImageNativeContext,
  signal?: AbortSignal,
): ImageNativeContext & { readonly abortSignal: AbortSignal } => {
  if (signal === undefined) return invalid();
  signal.throwIfAborted();
  context.abortSignal?.throwIfAborted();
  const actual =
    context.abortSignal === undefined || context.abortSignal === signal
      ? signal
      : AbortSignal.any([context.abortSignal, signal]);
  return { ...context, abortSignal: actual };
};

/** Only immutable native task/cutoff/attempt and owner evidence, never latest operation. */
export const verifyImageGenerationState = async (
  access: ImageRequestAccess,
  proof: GenerationRequestTicketProof,
  model: Model<Api>,
  context: ImageNativeContext,
): Promise<ChatCatalogModel> => {
  context.abortSignal?.throwIfAborted();
  if (model.provider !== proof.model.provider || model.id !== proof.model.modelId) invalid();
  const catalog = installedChatModel(model.id);
  if (
    catalog === null ||
    catalog.provider !== model.provider ||
    catalog.api !== model.api ||
    catalog.contextWindow !== model.contextWindow ||
    catalog.maxOutputTokens !== model.maxTokens
  )
    return invalid();
  const state = await readImageRequestState(access, proof.taskId, proof.conversationId, context);
  if (
    state.legacy !== (proof.legacy === true) ||
    state.taskId !== proof.taskId ||
    state.conversationId !== proof.conversationId ||
    state.cutoff !== proof.cutoff ||
    state.attempt !== proof.attempt ||
    state.submissionId !== proof.submissionId ||
    state.operationId !== proof.operationId ||
    !sameImageRequestValue(state.model, proof.model) ||
    !sameImageRequestValue(state.current, proof.current)
  )
    invalid();
  context.abortSignal?.throwIfAborted();
  return catalog;
};
