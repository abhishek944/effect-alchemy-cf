import {
  canonicalizePreparedRequest,
  catalogImageRoute,
  prepareImageRequest,
  type ImageArgs,
} from "@abhishek944/pi-image-gen/core";
import { AssistantEntry, type EntryId } from "@earendil-works/pi-durable";
import { Schema } from "effect";
import { digestText } from "./chat-internal.ts";
import { resolveImageCall } from "./chat-image-native-proof.ts";
import { requireImageAccess } from "./chat-image-request-accepted.ts";
import { authorizeImageHostSources, imageHostRefusal } from "./chat-image-host-sources.ts";
import type {
  ChatImageHostDependencies,
  ImageHostApi,
  ImageHostContext,
  ImageHostPlan,
} from "./chat-image-host-types.ts";

const NativeEntryId = Schema.declare<EntryId>(
  (value): value is EntryId =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0,
);

export function assertImageHostReady(
  deps: ChatImageHostDependencies,
  context: ImageHostContext,
): void {
  requireImageAccess(deps.proofAccess, context);
  if (
    deps.storage !== deps.proofAccess.storage ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(deps.expectedOwnerScope) ||
    deps.catalog.id.toString() !== deps.expectedOwnerScope ||
    deps.expectedOwnerScope === deps.proofAccess.chatScope ||
    deps.cloudflareRun === undefined
  )
    imageHostRefusal();
}

export async function prepareImageHostPlan(
  deps: ChatImageHostDependencies,
  api: ImageHostApi,
  context: ImageHostContext,
  args: Readonly<ImageArgs>,
): Promise<ImageHostPlan> {
  assertImageHostReady(deps, context);
  const proof = await resolveImageCall(api, context, args, deps.proofAccess);
  if (proof === null) return imageHostRefusal();
  const image = proof.snapshot.image;
  if (image.state !== "ready" || !deps.configurationReady(image)) return imageHostRefusal();
  const entryId = Schema.decodeUnknownSync(NativeEntryId)(Number(proof.assistantEntryId));
  const visible = await deps.storage.entry(api.conversationId, entryId, context);
  const entry = visible?.entry;
  const message = entry?.model?.[0];
  if (
    entry === undefined ||
    !AssistantEntry.is(entry) ||
    entry.model?.length !== 1 ||
    String(entry.byTaskId) !== proof.generationTaskId ||
    message?.role !== "assistant"
  )
    return imageHostRefusal();
  const tools = message.content.filter((part) => part.type === "toolCall");
  const callPosition = tools.findIndex((tool) => tool.id === proof.callId);
  if (callPosition < 0 || tools[callPosition]?.name !== "image_generate") return imageHostRefusal();
  const sources = await authorizeImageHostSources(deps, proof, context);
  assertImageHostReady(deps, context);
  const request = prepareImageRequest(
    {
      prompt: proof.args.prompt,
      ...(proof.args.image === undefined ? {} : { image: [...proof.args.image] }),
      ...(proof.args.size === undefined ? {} : { size: proof.args.size }),
      ...(proof.args.quality === undefined ? {} : { quality: proof.args.quality }),
    },
    { size: image.preferences.size, quality: image.preferences.quality },
    catalogImageRoute(image.model, image.gatewayId),
  );
  const canonicalRequest = canonicalizePreparedRequest(request);
  if (canonicalRequest.length > 256 * 1024) return imageHostRefusal();
  const requestDigest = await digestText(canonicalRequest);
  const key = await digestText(
    JSON.stringify([
      proof.snapshot.chatScope,
      proof.snapshot.conversationId,
      proof.operationId,
      entryId,
      0,
      proof.toolTaskId,
      proof.callId,
    ]),
  );
  deps.calls.admit({
    key,
    operationId: proof.operationId,
    logicalOperationId: proof.snapshot.logicalOperationId,
    assistantEntryId: entryId,
    modelIndex: 0,
    callPosition,
    toolTaskId: proof.toolTaskId,
    nativeCallId: proof.callId,
    requestDigest,
    canonicalRequest,
    args: request.supplied,
  });
  return {
    proof,
    key,
    request,
    requestDigest,
    sources,
    assistantEntryId: entryId,
    modelIndex: 0,
    callPosition,
  };
}

export async function recheckImageHostPlan(
  deps: ChatImageHostDependencies,
  plan: ImageHostPlan,
  api: ImageHostApi,
  context: ImageHostContext,
): Promise<void> {
  assertImageHostReady(deps, context);
  const current = await resolveImageCall(api, context, plan.request.supplied, deps.proofAccess);
  if (
    current === null ||
    current.operationId !== plan.proof.operationId ||
    current.submissionId !== plan.proof.submissionId ||
    current.toolTaskId !== plan.proof.toolTaskId ||
    current.assistantEntryId !== plan.proof.assistantEntryId ||
    current.snapshot.identityHash !== plan.proof.snapshot.identityHash ||
    current.snapshot.image.state !== "ready" ||
    !deps.configurationReady(current.snapshot.image)
  )
    imageHostRefusal();
}
