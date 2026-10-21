import { Schema } from "effect";
import {
  GenerationTask,
  LiveDoc,
  type ConversationId,
  type TaskId,
} from "@earendil-works/pi-durable";
import { decodeOption } from "./chat-internal.ts";
import {
  requireImageAccess,
  readPlacedImageInput,
  bindNativeImageInput,
} from "./chat-image-request-accepted.ts";
import { resolveLegacyImageInput } from "./chat-image-request-legacy.ts";
import type { ImageNativeContext, ImageRequestAccess } from "./chat-image-request-types.ts";
import { ImageEntryId, ImageSafeInteger, imageProofFailure } from "./chat-image-request-values.ts";

const RequestCheckpoint = Schema.Struct({
  phase: Schema.Literal("request"),
  attempt: ImageSafeInteger,
  cutoff: ImageEntryId,
  model: Schema.Struct({
    provider: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
    modelId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  }),
});

/** Resolve the asking task, never a global latest operation or runtime.liveInput(). */
export const readImageRequestState = async (
  access: ImageRequestAccess,
  taskId: TaskId,
  conversationId: ConversationId,
  context: ImageNativeContext,
) => {
  requireImageAccess(access, context);
  if (conversationId !== access.conversationId) imageProofFailure();
  const task = await access.storage.task(taskId, context);
  if (
    task === undefined ||
    task.id !== taskId ||
    task.kind !== GenerationTask.definition.name ||
    task.version !== GenerationTask.definition.version ||
    task.conversationId !== conversationId ||
    task.state.status !== "running" ||
    task.abortRequested
  )
    return imageProofFailure();
  const checkpoint = decodeOption(RequestCheckpoint, task.state.checkpoint);
  if (checkpoint === null) return imageProofFailure();
  const live = await access.rawHarness().snapshot(LiveDoc, conversationId, context);
  const submissionId = live?.run?.inputs[0];
  if (
    live?.run?.taskId !== taskId ||
    live.run.inputs.length !== 1 ||
    live.generation?.attempt !== checkpoint.attempt ||
    submissionId === undefined
  )
    return imageProofFailure();
  const native = await readPlacedImageInput(access, conversationId, submissionId, context);
  if (native.entry.id > checkpoint.cutoff) imageProofFailure();
  const source =
    access.responses.read(native.operationId) === null
      ? { legacy: true as const, current: resolveLegacyImageInput(access, native, context) }
      : { legacy: false as const, current: await bindNativeImageInput(access, native, context) };
  requireImageAccess(access, context);
  return {
    taskId,
    conversationId,
    cutoff: checkpoint.cutoff,
    attempt: checkpoint.attempt,
    model: checkpoint.model,
    submissionId,
    operationId: native.operationId,
    ...source,
  };
};
