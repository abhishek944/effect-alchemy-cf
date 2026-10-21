import { UserEntry, type UserInput } from "@earendil-works/pi-durable";
import type { OfficeSendTarget } from "@starter/office-contract";
import { installedChatModel } from "./chat-capability-catalog.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import { ChatInvalid } from "./chat-model.ts";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";
import { prepareCompactImageInput } from "./chat-image-input-preparation.ts";
import type { ImageInputPreparationAccess, ImageInputSource } from "./chat-image-input-types.ts";
import type { ImageNativeAccess } from "./chat-image-request-types.ts";
import { digestCompactImageInput } from "./chat-image-response-digest.ts";
import { requireImageAccess, verifyImageBoundEntry } from "./chat-image-request-accepted.ts";
import { retainAcceptedImageInput } from "./chat-image-retention.ts";
import type { ChatSendRecords } from "./chat-send-records.ts";
import { SkillRuntimeError } from "./chat-skills-errors.ts";
import type { SkillRecoveryImageInput } from "./chat-skills-recovery-image-input.ts";
import { sameRecoveryContent } from "./chat-skills-recovery-image-input.ts";

export type ImageRecoveryPreparation = {
  readonly preparation: ImageInputPreparationAccess;
  readonly proof: ImageNativeAccess;
  readonly records: ChatSendRecords;
  readonly env: ConversationFileEnv;
  readonly validateContext: (model: ChatCatalogModel) => Promise<void>;
};
const inconsistent = (): never => {
  throw new SkillRuntimeError(
    "unrecoverable",
    "The original message references could not be verified. Send a new message with the exact saved files instead.",
  );
};

/** A new attempt changes response capability, never original identity or prior spend authority. */
export const prepareChatImageRecovery = async (
  deps: ImageRecoveryPreparation,
  input: SkillRecoveryImageInput,
): Promise<UserInput> => {
  const { preparation, proof, records } = deps;
  const context = preparation.nativeContext;
  requireImageAccess(proof, context);
  const metadata = records.metadata(input.sourceAttemptId);
  const model = installedChatModel(input.selection.model);
  if (metadata === null || model === null) return inconsistent();
  try {
    await deps.validateContext(model);
  } catch (error) {
    if (error instanceof ChatInvalid) throw new SkillRuntimeError("invalid", error.message);
    throw error;
  }
  const known = preparation.responses.read(input.operationId);
  let officeTarget: OfficeSendTarget | undefined = known?.officeTarget;
  let text: string;
  let sources: ImageInputSource[];
  if (known !== null) {
    if (
      known.identityHash !== input.identityHash ||
      known.logicalOperationId !== input.logicalOperationId ||
      known.ownerId !== input.scope.ownerId ||
      known.chatId !== input.scope.chat.id ||
      (await digestCompactImageInput(input.content)) !== known.inputDigest
    )
      return inconsistent();
    const first =
      typeof input.content === "string"
        ? input.content
        : input.content[0]?.type === "text"
          ? input.content[0].text
          : null;
    if (first === null || first.length !== metadata.textLength) return inconsistent();
    text = first;
    sources = known.originals.map((original) => ({
      source: "saved",
      fileId: original.fileId,
      original,
    }));
  } else {
    if (input.reused) return inconsistent();
    const native = await proof.storage.submissionByRequest(
      proof.conversationId,
      input.sourceAttemptId,
      context,
    );
    if (
      native?.type !== "input" ||
      native.status === "queued" ||
      native.entry === undefined ||
      native.requestId !== input.sourceAttemptId ||
      native.conversationId !== proof.conversationId
    )
      return inconsistent();
    const visible = await proof.storage.entry(proof.conversationId, native.entry, context);
    const entry = visible?.entry;
    const message = entry?.model?.[0];
    if (
      !UserEntry.is(entry) ||
      entry.id !== native.entry ||
      entry.conversationId !== proof.conversationId ||
      entry.model?.length !== 1 ||
      message?.role !== "user" ||
      !Number.isFinite(message.timestamp) ||
      !sameRecoveryContent(message.content, input.content)
    )
      return inconsistent();
    const original = preparation.responses.read(input.sourceAttemptId);
    if (original === null) {
      // Preserve legacy history; do not guess a missing binary-to-file mapping or rewrite it.
      if (
        metadata.files.length !== 0 ||
        typeof input.content !== "string" ||
        input.content.length !== metadata.textLength
      )
        return inconsistent();
      text = input.content;
      sources = [];
    } else {
      officeTarget = original.officeTarget;
      const bound = preparation.responses.forEntry(String(proof.conversationId), native.entry, 0);
      if (
        bound === null ||
        bound.candidate.operationId !== input.sourceAttemptId ||
        original.logicalOperationId !== input.sourceLogicalOperationId ||
        original.identityHash !== records.identity(input.sourceAttemptId) ||
        String(native.id) !== bound.binding.submissionId ||
        original.originals.length !== metadata.files.length
      )
        return inconsistent();
      await verifyImageBoundEntry(proof, bound, entry);
      for (const [index, ref] of original.originals.entries()) {
        const file = metadata.files[index];
        if (
          file === undefined ||
          file.chatId !== input.scope.chat.id ||
          file.id !== ref.fileId ||
          file.name !== ref.name ||
          file.kind !== ref.kind ||
          file.byteSize !== ref.byteSize ||
          file.mediaType !== ref.mediaType ||
          file.width !== ref.width ||
          file.height !== ref.height
        )
          return inconsistent();
      }
      await retainAcceptedImageInput(proof, deps.env, bound, context);
      const first =
        typeof input.content === "string"
          ? input.content
          : input.content[0]?.type === "text"
            ? input.content[0].text
            : null;
      if (first === null || first.length !== metadata.textLength) return inconsistent();
      text = first;
      sources = original.originals.map((ref) => ({
        source: "saved",
        fileId: ref.fileId,
        original: ref,
      }));
    }
  }
  requireImageAccess(proof, context);
  try {
    const prepared = await prepareCompactImageInput(preparation, {
      operationId: input.operationId,
      logicalOperationId: input.logicalOperationId,
      identityHash: input.identityHash,
      ownerId: input.scope.ownerId,
      chatId: input.scope.chat.id,
      applicationOrigin: input.scope.applicationOrigin,
      text,
      ...(officeTarget === undefined ? {} : { officeTarget }),
      sources,
      model,
    });
    return prepared.content;
  } catch {
    throw new SkillRuntimeError(
      "unavailable",
      "The saved references or image preferences could not be prepared for this attempt. No image generation was started.",
    );
  }
};
