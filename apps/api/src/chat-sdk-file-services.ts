import type { ChatObjectContext } from "./chat-object.ts";
import { createGatewayImageAdapter } from "./chat-gateway-image-adapter.ts";
import { gatewayImageReady, imageGatewayId } from "./chat-gateway-images.ts";
import type { Context } from "@earendil-works/pi-ai";
import type * as cf from "./platform.ts";
import { createChatSdkFiles } from "./chat-sdk-files.ts";
import { createChatSdkImages } from "./chat-sdk-images.ts";
import type { ChatSdkFiles } from "./chat-sdk-files-types.ts";
import type { ChatToolScope } from "./chat-sdk-tool.ts";
import type { ChatRuntime } from "./chat-runtime.ts";
import type { ChatOwnerBinding } from "./chat-tool-authorization.ts";
import type { ChatImageResponseStore } from "./chat-image-response-store.ts";
import type { ChatImageCallStore } from "./chat-image-call-store.ts";
import { acceptedContextInputs } from "./chat-sdk-context.ts";
import { imageContextEstimateMessages } from "./chat-image-context.ts";
import { ChatUnavailable } from "./chat-model.ts";
import { createChatSdkClassifier } from "./chat-sdk-classifier.ts";

export type SdkFileEnv = {
  readonly ChatCatalog?: cf.DurableObjectNamespace;
  readonly CHAT_FILES?: cf.R2Bucket;
  readonly LITELLM_ENABLED?: string;
  readonly LITELLM_BASE_URL?: string;
  readonly LITELLM_INFERENCE_KEY?: string;
  readonly CHAT_IDENTITY_SECRET?: string;
  readonly APP_STAGE?: string;
  readonly LITELLM_CLASSIFIER_MODEL?: string;
  readonly LITELLM_CLASSIFIER_API?: string;
};
export const createSdkFileServices = (input: {
  readonly ctx: ChatObjectContext;
  readonly env: SdkFileEnv;
  readonly runtime: ChatRuntime;
  readonly owners: ChatOwnerBinding;
  readonly responses: ChatImageResponseStore;
  readonly calls: ChatImageCallStore;
}) => {
  const { ctx, env, runtime, owners, responses } = input;
  const scope = {
    chatName: () => ctx.id.name,
    chatScope: () => ctx.id.toString(),
    owners,
    conversationId: async () => String(runtime.transcript.id),
    catalog: (ownerId: string) => {
      if (env.ChatCatalog === undefined) throw new ChatUnavailable();
      return env.ChatCatalog.getByName(`owner:${ownerId}`);
    },
  };
  const inputs = (context: Context) =>
    acceptedContextInputs({
      context,
      entries: runtime.transcript.contextView().entries,
      currentEntry: runtime.active?.record.entry ?? -1,
      inputTimestamp: runtime.active?.inputTimestamp,
      responses,
    });
  const assertLive = (tool: ChatToolScope): void => {
    tool.signal.throwIfAborted();
    const active = runtime.active;
    if (
      active === null ||
      active.record.operationId !== tool.operationId ||
      active.controller.signal !== tool.signal ||
      owners.owner() !== tool.ownerId ||
      ctx.id.name !== `chat:${tool.ownerId}:${tool.chatId}` ||
      ctx.id.toString() !== tool.chatScope
    )
      throw new Error("The tool no longer owns this accepted operation");
  };
  let files: ChatSdkFiles | null = null;
  if (env.CHAT_FILES !== undefined)
    files = createChatSdkFiles({
      ...scope,
      bucket: env.CHAT_FILES,
      responses,
      imageGatewayId: (model) => imageGatewayId(env, model),
      acceptedFor: (context) => inputs(context).accepted,
    });
  const tools =
    env.CHAT_FILES === undefined
      ? []
      : createChatSdkImages({
          ...scope,
          bucket: env.CHAT_FILES,
          responses,
          calls: input.calls,
          imageAdapter: (image, tool, onDispatch) =>
            createGatewayImageAdapter(env, image, tool, onDispatch),
          configurationReady: (image) => gatewayImageReady(env, image),
          isAcceptedOperation: (operationId) => runtime.transcript.run(operationId) !== null,
          assertLive,
          accepted: (tool) => {
            assertLive(tool);
            const acceptedRun = runtime.transcript.run(tool.operationId);
            if (acceptedRun === null || acceptedRun.entry === null) return null;
            const bound = responses.forEntry(String(runtime.transcript.id), acceptedRun.entry, 0);
            const assistant = runtime.transcript.entry(tool.assistantEntry)?.model?.[0];
            return bound === null || assistant?.role !== "assistant"
              ? null
              : { ...bound, assistant };
          },
        }).descriptors;
  return {
    files,
    tools: [...tools, ...createChatSdkClassifier(env, assertLive)],
    hydrateContext: (context: Context) => inputs(context).context,
    estimateMessages: async () => {
      try {
        const view = runtime.transcript.contextView();
        const mapped = inputs({ messages: [...view.messages] });
        return imageContextEstimateMessages(
          mapped.context.messages,
          mapped.accepted.map(({ requestIndex, candidate }) => ({
            requestIndex,
            originals: candidate.originals,
          })),
        );
      } catch {
        return null;
      }
    },
  };
};
