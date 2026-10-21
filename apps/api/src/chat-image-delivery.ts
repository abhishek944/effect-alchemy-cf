import type { ImageNativeAccess, ImageNativeContext } from "./chat-image-request-types.ts";
import type { ImageBoundInput } from "./chat-image-response-schema.ts";
import { requireImageAccess, verifyImageBoundEntry } from "./chat-image-request-accepted.ts";

/** Current delivery only, after full ascending reconstruction; never a legacy/backfill shortcut. */
export const bindAcceptedImageDelivery = async (
  access: ImageNativeAccess,
  operationId: string,
  context: ImageNativeContext,
): Promise<ImageBoundInput> => {
  requireImageAccess(access, context);
  const native = await access.storage.submissionByRequest(
    access.conversationId,
    operationId,
    context,
  );
  const candidate = access.responses.read(operationId);
  if (
    native?.type !== "input" ||
    native.status === "queued" ||
    native.entry === undefined ||
    native.conversationId !== access.conversationId ||
    native.requestId !== operationId ||
    candidate === null
  )
    throw new Error("Native accepted image input is not yet available.");
  const visible = await access.storage.entry(access.conversationId, native.entry, context);
  if (visible === undefined) throw new Error("Native accepted input is unavailable.");
  const binding = {
    operationId,
    submissionId: String(native.id),
    conversationId: String(access.conversationId),
    entryId: native.entry,
    modelIndex: 0,
    inputDigest: candidate.inputDigest,
  };
  await verifyImageBoundEntry(access, { candidate, binding }, visible.entry);
  requireImageAccess(access, context);
  return access.responses.bindAccepted(binding);
};
