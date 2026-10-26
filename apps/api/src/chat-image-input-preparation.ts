import { freezeChatReferenceInputs, freezeOfficeSendTarget } from "@starter/office-contract";
import { createChatFilesCatalogClient } from "./chat-files-client.ts";
import { digestCompactImageInput } from "./chat-image-response-digest.ts";
import { ImageResponseError, responseValue } from "./chat-image-response-codec.ts";
import { ImageResponseCandidate } from "./chat-image-response-schema.ts";
import {
  compactImageInput,
  requireImageInputOwner,
  requireImageInputRequest,
  requireMatchingImageCandidate,
} from "./chat-image-input-content.ts";
import { prepareImageInputFiles } from "./chat-image-input-files.ts";
import { freezeImageInputCapability } from "./chat-image-input-preferences.ts";
import { validateOriginalReferenceSlices } from "./chat-reference-original-admission.ts";
import {
  ImageInputError,
  type ImageInputPreparationAccess,
  type ImageInputRequest,
  type PreparedImageInput,
} from "./chat-image-input-types.ts";

/**
 * Parent MUST hold the existing admission fence and call before any native submit.
 * Installs no harness/gate. No original body or old native-input builder is used.
 */
export async function prepareCompactImageInput(
  access: ImageInputPreparationAccess,
  request: ImageInputRequest,
  signal?: AbortSignal,
): Promise<PreparedImageInput> {
  const input = {
    ...request,
    ...(request.officeTarget === undefined
      ? {}
      : { officeTarget: freezeOfficeSendTarget(request.officeTarget) }),
    ...(request.referenceInputs === undefined
      ? {}
      : { referenceInputs: freezeChatReferenceInputs(request.referenceInputs) }),
    sources: request.sources.map((source) => ({ ...source })),
  };
  requireImageInputRequest(input);
  requireImageInputOwner(access, input.ownerId, input.chatId);
  signal?.throwIfAborted();
  const chatScope = access.account.chatScope();
  const known = access.responses.read(input.operationId);
  if (known !== null) requireMatchingImageCandidate(access, input, known);
  else {
    // Never introduce a new image-era candidate for an already admitted legacy op.
    let native;
    try {
      native = await access.account
        .storage()
        .submissionByRequest(access.conversationId, input.operationId, access.nativeContext);
    } catch {
      throw new ImageInputError(
        signal?.aborted || access.nativeContext.abortSignal?.aborted ? "cancelled" : "unavailable",
      );
    }
    if (native !== undefined) throw new ImageInputError("conflict");
    signal?.throwIfAborted();
    requireImageInputOwner(access, input.ownerId, input.chatId, chatScope);
  }
  const stub = access.account.catalog(input.ownerId);
  const catalog = createChatFilesCatalogClient(stub);
  let persisted = known !== null;
  try {
    const files = await prepareImageInputFiles(
      catalog,
      stub,
      input,
      known?.applicationOrigin ?? input.applicationOrigin,
      known?.originals,
      signal,
    );
    await validateOriginalReferenceSlices(
      access.referenceFiles,
      stub,
      input.chatId,
      input.referenceInputs ?? [],
      files.files,
      signal,
    );
    requireImageInputOwner(access, input.ownerId, input.chatId, chatScope);
    const content = compactImageInput(
      input.text,
      known?.originals ?? files.originals,
      input.officeTarget,
      input.referenceInputs,
    );
    const inputDigest = await digestCompactImageInput(content);
    signal?.throwIfAborted();
    if (known !== null && inputDigest !== known.inputDigest) throw new ImageInputError("conflict");
    let image = known?.image;
    if (image === undefined) {
      let gatewayId: string | null;
      try {
        gatewayId = access.imageGatewayId();
      } catch {
        gatewayId = null;
      }
      image = await freezeImageInputCapability(stub, gatewayId, signal);
    }
    requireImageInputOwner(access, input.ownerId, input.chatId, chatScope);
    const candidate =
      known ??
      access.responses.insert(
        responseValue(ImageResponseCandidate, {
          version: 1,
          operationId: input.operationId,
          logicalOperationId: input.logicalOperationId,
          identityHash: input.identityHash,
          ownerId: input.ownerId,
          chatId: input.chatId,
          chatScope,
          conversationId: String(access.conversationId),
          applicationOrigin: input.applicationOrigin,
          image,
          inputDigest,
          originals: files.originals,
          ...(input.officeTarget === undefined ? {} : { officeTarget: input.officeTarget }),
          ...(input.referenceInputs === undefined
            ? {}
            : { referenceInputs: input.referenceInputs }),
        }),
      );
    persisted = true;
    return Object.freeze({
      content,
      files: Object.freeze(files.files),
      candidate,
      uploadIds: Object.freeze(files.uploadIds),
      ownerScope: catalog.scope,
      reused: known !== null,
    });
  } catch (error) {
    // This path has NEVER submitted. Do not release a known/possibly accepted candidate.
    if (!persisted && input.sources.some((source) => source.source === "upload")) {
      await catalog
        .release({ operationId: input.operationId, chatId: input.chatId, now: Date.now() })
        .catch(() => undefined);
    }
    if (signal?.aborted) throw new ImageInputError("cancelled");
    if (error instanceof ImageInputError || error instanceof ImageResponseError) throw error;
    throw new ImageInputError("unavailable");
  }
}
