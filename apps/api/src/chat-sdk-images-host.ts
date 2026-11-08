/**
 * Real image I/O for the Worker's image_generate tool.
 *
 * The published portable engine owns one dispatch and materialization. This host
 * binds trusted Gateway options to the actual AI binding, loads only authorized
 * retained originals, stores each immutable output through the owner catalog and
 * waits for real provider/body/storage work before the call is finalized. It does
 * not serialize providers, retry a paid request or fabricate a result.
 */
import type { ImageHost, ImageMetadata } from "@abhishek944/pi-image-gen/core";
import { reportFailure } from "@highchat/diagnostics";
import { ImageIOError } from "./chat-image-io-error.ts";
import { runImageIO } from "./chat-image-io.ts";
import { retainImageResponseBody } from "./chat-image-io-response.ts";
import { readAcceptedOriginal } from "./chat-image-original.ts";
import { NATIVE_IMAGE_TIMEOUT_MS } from "./chat-image-policy.ts";
import type { ImageResponseCandidate } from "./chat-image-response-schema.ts";
import type { ChatSdkImagesDeps } from "./chat-sdk-files-types.ts";
import type { ChatToolScope } from "./chat-sdk-tool.ts";
import type { ChatGeneratedClient } from "./chat-generated-client.ts";
import type { ImageHostSource } from "./chat-sdk-images-sources.ts";
import { ChatImageRefusal, safeGatewayOutputUrl, trackImageWork } from "./chat-sdk-images-work.ts";
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

/** No provider serializer: package-supplied model/input/options reach the real binding. */
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
    async loadOutput(providerUrl, signal) {
      const parsed = safeGatewayOutputUrl(providerUrl);
      if (parsed === null)
        throw new ImageIOError("output_url_refused", "Image output URLs are not enabled.");
      signal?.throwIfAborted();
      return trackImageWork(runtime, async () => {
        const response = await fetch(parsed.toString(), { signal: signal ?? null });
        if (!response.ok) throw new ImageIOError("io_failed", "The image output download failed.");
        const buffer = await response.arrayBuffer();
        signal?.throwIfAborted();
        return {
          bytes: new Uint8Array(buffer),
          mimeType: response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "",
        };
      });
    },
    cloudflareRun(model, input, options) {
      return runImageIO({
        track: (work) => trackImageWork(runtime, work),
        signal: options.signal,
        async run() {
          deps.assertLive(scope);
          options.signal?.throwIfAborted();
          const image = candidate.image;
          const binding = deps.cloudflareRun;
          if (
            image.state !== "ready" ||
            !deps.configurationReady(image) ||
            model !== image.model ||
            options.gateway.id !== image.gatewayId ||
            binding === undefined
          )
            throw new ChatImageRefusal();
          deps.assertLive(scope);
          if (!deps.calls.markDispatched(key)) throw new ChatImageRefusal();
          runtime.state.dispatched = true;
          // Log every image request at the gateway; the package default hides these calls.
          const logging = {
            ...options,
            gateway: { ...options.gateway, collectLog: true },
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberate opt-in: Workers AI accepts boolean, package types pin false.
          } as unknown as typeof options;
          const raw = await binding(model, input, logging);
          if (!(raw instanceof Response))
            throw new ImageIOError("io_failed", "The image binding did not return a raw response.");
          const response = await retainImageResponseBody({
            response: raw,
            track: (work) => trackImageWork(runtime, work),
            operationId: candidate.operationId,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
          runtime.responses.add(response);
          return response;
        },
        async disposeLate(response) {
          await response.body?.cancel().catch(() => undefined);
        },
        onLateFailure(error) {
          if (!runtime.state.dispatched) return;
          reportFailure(error, {
            component: "chat-image",
            operation: "late-provider",
            event: "application.failure",
            operationId: candidate.operationId,
            callId: key,
          });
        },
      });
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
