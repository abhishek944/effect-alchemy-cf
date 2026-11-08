import {
  createProvider,
  type Api,
  type AssistantMessageEventStream,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
  type StreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { RunChannel } from "./channel.ts";

/**
 * The SDK dispatches provider work by model, so the host registers one native
 * provider whose stream never dials anything: it asks the Worker for the turn.
 * `baseUrl` is a local sentinel because no outbound request is ever made.
 */
const RemoteApi = "highchat-transport";
const RemoteBaseUrl = "http://127.0.0.1:0/no-outbound-requests";

/** Credential store that cannot read, write or invent a provider credential. */
const noCredentials = {
  read: async () => undefined,
  list: async () => [],
  modify: async () => undefined,
  delete: async (): Promise<void> => {},
};

export interface RemoteModel {
  readonly runtime: ModelRuntime;
  readonly model: Model<typeof RemoteApi>;
}

const streams = (channel: RunChannel): ProviderStreams => {
  const start = (
    _model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions & StreamOptions,
  ): AssistantMessageEventStream => {
    return channel.openModel(
      {
        kind: channel.isCompacting() ? "compaction" : "generation",
        model: channel.request.model,
        context: { messages: context.messages },
        options: {
          ...(options?.reasoning === undefined ? {} : { reasoning: options.reasoning }),
          // The SDK sets an explicit output allowance for summarization turns.
          ...(options?.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
        },
      },
      options?.signal,
    ).stream;
  };
  return { stream: start, streamSimple: start };
};

export const openRemoteModel = async (channel: RunChannel): Promise<RemoteModel> => {
  const { selection, model: descriptor } = channel.request;
  const runtime = await ModelRuntime.create({
    credentials: noCredentials,
    refreshOnCreate: false,
    allowModelNetwork: false,
    modelsPath: null,
  });
  const model: Model<typeof RemoteApi> = {
    id: selection.model,
    name: selection.model,
    api: RemoteApi,
    provider: selection.provider,
    baseUrl: RemoteBaseUrl,
    input: descriptor.input,
    cost: descriptor.cost,
    contextWindow: descriptor.contextWindow,
    maxTokens: descriptor.maxTokens,
    reasoning: descriptor.reasoning,
    ...(descriptor.thinkingLevelMap === undefined
      ? {}
      : { thinkingLevelMap: descriptor.thinkingLevelMap }),
  };
  runtime.registerNativeProvider(
    createProvider<typeof RemoteApi>({
      id: selection.provider,
      name: selection.provider,
      auth: {
        apiKey: {
          name: "Worker-transported model",
          resolve: async () => ({ auth: {} }),
        },
      },
      models: [model],
      api: streams(channel),
    }),
  );
  return { runtime, model };
};
