/**
 * Build or reuse the immutable compact candidate for one send.
 *
 * Uploads are bound by the owner catalog, saved references are verified by
 * owner/chat metadata, image preferences are frozen once, and only compact
 * original identifiers enter the prepared content. A duplicate operation must
 * match every frozen field instead of rebinding a later draft.
 */
import { freezeChatReferenceInputs } from "@highchat/chat-contract";
import type { ChatReferenceInputs } from "@highchat/chat-contract";
import { createChatFilesCatalogClient } from "./chat-files-client.ts";
import { digestText } from "./chat-internal.ts";
import { prepareImageInputFiles } from "./chat-image-input-files.ts";
import { compactImageInput } from "./chat-image-input-content.ts";
import type { ImageInputRequest } from "./chat-image-input-types.ts";
import { freezeImageInputCapability } from "./chat-image-input-preferences.ts";
import { digestCompactImageInput } from "./chat-image-response-digest.ts";
import { ImageResponseCandidate } from "./chat-image-response-schema.ts";
import { responseValue } from "./chat-image-response-codec.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import {
  requireRequest,
  sourcesFor,
  fail,
  requireKnown,
  translated,
} from "./chat-sdk-files-input.ts";
import { ChatSdkFilesError, isTextInput } from "./chat-sdk-files-types.ts";
import type { TextInput } from "./chat-sdk-files-types.ts";
import type {
  ChatSdkFilesDeps,
  ChatSdkInput,
  ChatSdkPrepareScope,
  ChatSdkPrepared,
} from "./chat-sdk-files-types.ts";
import { validateReferenceSlices } from "./chat-sdk-files-slices.ts";
import { sendIdentity } from "./chat-send-identity.ts";
import { chatSdkOwner } from "./chat-sdk-files-types.ts";

export const prepareChatSdkFiles = async (
  deps: ChatSdkFilesDeps,
  input: ChatSdkInput,
  scope: ChatSdkPrepareScope,
  model: ChatCatalogModel,
): Promise<ChatSdkPrepared> => {
  const owner = chatSdkOwner(deps);
  const chatScope = deps.chatScope();
  if (owner === null) throw new ChatSdkFilesError("conflict");
  if (owner !== scope.ownerId) throw new ChatSdkFilesError("conflict");
  if (deps.chatName() !== `chat:${owner}:${scope.chat.id}` || chatScope.length === 0)
    fail("conflict");
  const conversationId = await deps.conversationId();
  if (conversationId.length === 0) fail("unavailable");
  const stub = deps.catalog(owner);
  const catalog = createChatFilesCatalogClient(stub);
  const referenceInputs: ChatReferenceInputs | undefined =
    input.referenceInputs === undefined
      ? undefined
      : freezeChatReferenceInputs(input.referenceInputs);
  const identityHash = await digestText(sendIdentity(input));
  const sources = sourcesFor(input);
  const known = deps.responses.read(input.operationId);
  if (known !== null)
    requireKnown({
      candidate: known,
      ownerId: owner,
      chatId: scope.chat.id,
      chatScope,
      conversationId,
      identityHash,
      referenceInputs,
      sources,
    });
  const request: ImageInputRequest = {
    operationId: input.operationId,
    logicalOperationId: input.operationId,
    identityHash,
    ownerId: owner,
    chatId: scope.chat.id,
    applicationOrigin: scope.applicationOrigin,
    text: input.text,
    ...(referenceInputs === undefined ? {} : { referenceInputs }),
    sources,
    model,
  };
  let persisted = known !== null;
  try {
    requireRequest(request);
    scope.signal?.throwIfAborted();
    const files = await prepareImageInputFiles(
      catalog,
      stub,
      request,
      known?.applicationOrigin ?? scope.applicationOrigin,
      known?.originals,
      scope.signal,
    );
    await validateReferenceSlices({
      bucket: deps.bucket,
      ownerScope: catalog.scope,
      chatId: scope.chat.id,
      references: referenceInputs ?? [],
      files: files.files,
      ...(scope.signal === undefined ? {} : { signal: scope.signal }),
    });
    const compact = compactImageInput(
      input.text,
      known?.originals ?? files.originals,
      referenceInputs,
    );
    const content: TextInput = isTextInput(compact) ? compact : fail("corrupt");
    const inputDigest = await digestCompactImageInput(compact);
    scope.signal?.throwIfAborted();
    if (known !== null && inputDigest !== known.inputDigest) fail("conflict");
    let image = known?.image;
    if (image === undefined)
      image = await freezeImageInputCapability(stub, deps.imageGatewayId(), scope.signal);
    const applicationOrigin = known === null ? scope.applicationOrigin : known.applicationOrigin;
    const candidate =
      known ??
      deps.responses.insert(
        responseValue(ImageResponseCandidate, {
          version: 1,
          operationId: input.operationId,
          logicalOperationId: input.operationId,
          identityHash,
          ownerId: owner,
          chatId: scope.chat.id,
          chatScope,
          conversationId,
          applicationOrigin,
          image,
          inputDigest,
          originals: files.originals,
          ...(referenceInputs === undefined ? {} : { referenceInputs }),
        }),
      );
    persisted = true;
    return Object.freeze({
      candidate,
      content,
      files: Object.freeze(files.files),
      uploadIds: Object.freeze(files.uploadIds),
      ownerScope: catalog.scope,
      reused: known !== null,
    });
  } catch (error) {
    // This path has never submitted: release only this operation's staged uploads.
    if (!persisted && sources.some((source) => source.source === "upload"))
      await catalog
        .release({ operationId: input.operationId, chatId: scope.chat.id, now: Date.now() })
        .catch(() => undefined);
    throw translated(error, scope.signal);
  }
};
