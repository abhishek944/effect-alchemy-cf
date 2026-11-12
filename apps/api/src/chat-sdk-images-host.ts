/** API-owned I/O for image_generate; SDK owns provider serialization and validation. */
import type { ImageHost, ImageMetadata } from "@abhishek944/pi-image-gen/core";
import { loadGatewayImageOutput } from "./chat-gateway-image-io.ts";
import { readAcceptedOriginal } from "./chat-image-original.ts";
import { NATIVE_IMAGE_TIMEOUT_MS } from "./chat-image-policy.ts";
import type { ImageResponseCandidate } from "./chat-image-response-schema.ts";
import type { ChatSdkImagesDeps } from "./chat-sdk-files-types.ts";
import type { ChatToolScope } from "./chat-sdk-tool.ts";
import type { ChatGeneratedClient } from "./chat-generated-client.ts";
import type { ImageHostSource } from "./chat-sdk-images-sources.ts";
import { ChatImageRefusal, trackImageWork } from "./chat-sdk-images-work.ts";
import type { SavedFile } from "./chat-library-schema.ts";

export type ImageHostRuntime = {
  readonly deps: ChatSdkImagesDeps;
  readonly scope: ChatToolScope;
  readonly key: string;
  readonly candidate: ImageResponseCandidate;
  readonly sources: readonly ImageHostSource[];
  readonly client: ChatGeneratedClient;
  readonly ownerScope: string;
  readonly state: {
    readonly files: Map<number, SavedFile>;
    dispatched: boolean;
    storing: boolean;
    metadata?: ImageMetadata | undefined;
  };
  readonly pending: Set<Promise<unknown>>;
  readonly responses: Set<Response>;
};

/** The public SDK adapter owns serialization; this host retains private original/storage authority. */
export const createImageHost = (runtime: ImageHostRuntime): ImageHost<SavedFile> => {
  const { deps, scope, key, candidate, state, ownerScope } = runtime;
  const chatId = candidate.chatId;
  return {
    signal: scope.signal,
    timeoutMs: NATIVE_IMAGE_TIMEOUT_MS,
    loadOriginal(reference, signal) {
      const source = runtime.sources[reference.index];
      if (reference.role !== "image" || source === undefined || source.url !== reference.url)
        return Promise.reject(new ChatImageRefusal());
      return readAcceptedOriginal({
        bucket: deps.bucket,
        ownerScope,
        chatId,
        metadata: { state: "accepted", ownerScope, file: source.authority.file },
        track: (work) => trackImageWork(runtime, work),
        ...(signal === undefined ? {} : { signal }),
      });
    },
    loadOutput: (url, signal) => trackImageWork(runtime, () => loadGatewayImageOutput(url, signal)),
    adapter: {
      generate: (...args) =>
        trackImageWork(runtime, () => {
          const image = candidate.image;
          if (image.state !== "ready" || !deps.configurationReady(image))
            throw new ChatImageRefusal();
          const adapter = deps.imageAdapter(image, scope, () => {
            deps.assertLive(scope);
            if (!deps.calls.markDispatched(key)) throw new ChatImageRefusal();
            state.dispatched = true;
          });
          return adapter.generate(...args);
        }),
    },
    store(output, index, context) {
      context.signal.throwIfAborted();
      state.storing = true;
      return trackImageWork(runtime, async () => {
        const file = await runtime.client.sink({ chatId, callId: key })(output, index, context);
        if (
          file.chatId !== chatId ||
          file.origin !== "generated" ||
          file.kind !== "image" ||
          !["ready", "unavailable"].includes(file.state) ||
          file.expiresAt !== null ||
          file.generation?.callId !== key ||
          file.generation.operationId !== candidate.operationId
        )
          throw new ChatImageRefusal();
        const known = state.files.get(index);
        if (known !== undefined && known.id !== file.id) throw new ChatImageRefusal();
        state.files.set(index, file);
        return file;
      });
    },
  };
};
