/**
 * One image_generate execution: exact accepted operation, one admission, one
 * paid dispatch, immutable receipts.
 *
 * The Worker has already proven the assistant tool-call lineage and passes the
 * object-selected scope. This module rechecks the accepted candidate and frozen
 * image capability, derives the call position from the accepted assistant entry,
 * authorizes edit sources by catalog identity, reserves/consumes the owner call,
 * runs the portable engine once and records usage/cost. It never replays.
 */
import {
  canonicalizePreparedRequest,
  generateImageCore,
  prepareImageRequest,
} from "@abhishek944/pi-image-gen/core";
import { digestText } from "./chat-internal.ts";
import { gatewayImageRoute } from "./chat-gateway-images.ts";
import { createChatGeneratedClient, type ChatGeneratedClient } from "./chat-generated-client.ts";
import { decodeImageArguments } from "./chat-sdk-images-args.ts";
import type { ImageResponseCandidate } from "./chat-image-response-schema.ts";
import { chatSdkOwner, type ChatSdkImagesDeps } from "./chat-sdk-files-types.ts";
import type { ChatToolResult, ChatToolScope } from "./chat-sdk-tool.ts";
import { createImageHost, type ImageHostRuntime } from "./chat-sdk-images-host.ts";
import { cancelImageResponses, drainImageWork } from "./chat-sdk-images-work.ts";
import {
  imageFileEntries,
  imageFiles,
  imageToolResult,
  rememberImageMetadata,
} from "./chat-sdk-images-result.ts";
import { finishImageCall, recordImageFailure } from "./chat-sdk-images-accounting.ts";
import { authorizeImageSources } from "./chat-sdk-images-sources.ts";
const fail = (candidate: ImageResponseCandidate | undefined, message: string): ChatToolResult =>
  imageToolResult(candidate, [], undefined, message, true);
export const runImageTool = async (
  deps: ChatSdkImagesDeps,
  input: unknown,
  scope: ChatToolScope,
): Promise<ChatToolResult> => {
  const accepted = deps.accepted(scope);
  if (accepted === null)
    return fail(undefined, "The accepted image request could not be verified.");
  const candidate = accepted.candidate;
  const owner = chatSdkOwner(deps);
  if (
    owner === null ||
    owner !== scope.ownerId ||
    deps.chatScope() !== scope.chatScope ||
    deps.chatName() !== `chat:${owner}:${scope.chatId}` ||
    candidate.operationId !== scope.operationId ||
    candidate.ownerId !== scope.ownerId ||
    candidate.chatId !== scope.chatId ||
    candidate.chatScope !== scope.chatScope ||
    candidate.conversationId !== scope.conversationId ||
    accepted.binding.operationId !== candidate.operationId ||
    accepted.binding.inputDigest !== candidate.inputDigest
  )
    return fail(undefined, "The accepted image request does not match this chat operation.");
  const args = decodeImageArguments(input);
  if (args === null)
    return fail(candidate, "The image arguments are not valid, so nothing was generated.");
  const image = candidate.image;
  if (image.state !== "ready" || !deps.configurationReady(image))
    return fail(
      candidate,
      "Image generation is unavailable for this request. No provider request was sent.",
    );
  const calls = accepted.assistant.content.filter((part) => part.type === "toolCall");
  const callPosition = calls.findIndex((part) => part.id === scope.callId);
  if (callPosition < 0 || calls[callPosition]?.name !== "image_generate")
    return fail(candidate, "This image call is not part of the accepted assistant entry.");
  let key: string | undefined;
  let client: ChatGeneratedClient | undefined;
  let runtime: ImageHostRuntime | undefined;
  try {
    deps.assertLive(scope);
    scope.signal.throwIfAborted();
    const request = prepareImageRequest(
      {
        prompt: args.prompt,
        ...(args.image === undefined ? {} : { image: [...args.image] }),
        ...(args.size === undefined ? {} : { size: args.size }),
        ...(args.quality === undefined ? {} : { quality: args.quality }),
      },
      { size: image.preferences.size, quality: image.preferences.quality },
      gatewayImageRoute(image),
    );
    const canonicalRequest = canonicalizePreparedRequest(request);
    const requestDigest = await digestText(canonicalRequest);
    key = await digestText(
      JSON.stringify([
        candidate.chatScope,
        candidate.conversationId,
        scope.operationId,
        scope.assistantEntry,
        0,
        callPosition,
        scope.callId,
      ]),
    );
    if (
      !deps.calls.admit({
        key,
        operationId: candidate.operationId,
        logicalOperationId: candidate.logicalOperationId,
        assistantEntryId: scope.assistantEntry,
        modelIndex: 0,
        callPosition,
        toolTaskId: `sdk:${scope.operationId}:${scope.assistantEntry}`,
        nativeCallId: scope.callId,
        requestDigest,
        canonicalRequest,
        args: request.supplied,
      }).fresh
    )
      return fail(candidate, "This image call was already handled. No new generation was started.");
    if (!deps.calls.start(key))
      return fail(candidate, "This image call could not claim its one dispatch.");
    client = createChatGeneratedClient(deps.catalog(candidate.ownerId));
    const sources = await authorizeImageSources(deps, candidate, args.image, scope.signal);
    await client.reserve({
      chatId: candidate.chatId,
      callId: key,
      operationId: candidate.operationId,
      requestDigest,
      sources: sources.map((source) => source.authority.file.id),
      model: image.preferences.model,
      size: args.size ?? image.preferences.size,
      quality: args.quality ?? image.preferences.quality,
    });
    deps.assertLive(scope);
    if (!(await client.consume({ chatId: candidate.chatId, callId: key })).dispatch) {
      deps.calls.record(key, {
        status: "unresolved",
        outcome: { dispatched: true, uncertain: true, storageUncertain: false, partial: false },
        files: [],
      });
      return fail(candidate, "This image dispatch was already consumed. It was not repeated.");
    }
    deps.assertLive(scope);
    runtime = {
      deps,
      scope,
      key,
      candidate,
      sources,
      client,
      ownerScope: deps.catalog(candidate.ownerId).id.toString(),
      state: { files: new Map(), dispatched: false, storing: false },
      pending: new Set(),
      responses: new Set(),
    };
    const result = await generateImageCore(request, createImageHost(runtime));
    if (!runtime.state.dispatched || result.images.length !== runtime.state.files.size)
      throw new Error("Image outputs could not be verified.");
    const metadata = rememberImageMetadata(result.metadata);
    if (metadata === null) throw new Error("Image accounting could not be verified.");
    runtime.state.metadata = metadata;
    const outcome = {
      dispatched: runtime.state.dispatched,
      uncertain: false,
      storageUncertain: false,
      partial: false,
    };
    const entries = imageFileEntries(runtime.state);
    deps.calls.record(key, {
      status: "complete",
      outcome,
      metadata,
      files: entries.map((entry) => ({ index: entry.index, file: entry.file })),
    });
    return imageToolResult(
      candidate,
      imageFiles(runtime.state),
      outcome,
      entries.length === 0
        ? "Image work finished without a usable output."
        : "Image saved. Use its exact original link for viewing or a later explicit edit request.",
      entries.length === 0,
    );
  } catch (error) {
    const outcome = key === undefined ? undefined : recordImageFailure(deps, key, runtime, error);
    return imageToolResult(
      candidate,
      runtime === undefined ? [] : imageFiles(runtime.state),
      outcome,
      runtime?.state.dispatched === true
        ? "Image work did not finish cleanly. Saved results are retained. Do not repeat generation without a new explicit request."
        : "The image call was not dispatched. Check references and image settings.",
      true,
    );
  } finally {
    if (runtime !== undefined) {
      await cancelImageResponses(runtime);
      await drainImageWork(runtime);
    }
    if (client !== undefined && key !== undefined)
      await finishImageCall(deps, client, candidate, key);
  }
};
