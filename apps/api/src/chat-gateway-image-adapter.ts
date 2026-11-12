import { trackImageWork, drainImageWork } from "./chat-sdk-images-work.ts";
import { generateImage } from "@abhishek944/pi-image-gen";
import { catalogImageRoute, type ImageHost } from "@abhishek944/pi-image-gen/core";
import { withTemporaryFiles } from "@highchat/platform";
import { gatewayConfig } from "./chat-gateway-config.ts";
import { gatewayImageSettings } from "./chat-gateway-images.ts";
import { gatewayImageFetch } from "./chat-gateway-image-io.ts";
import { chatIdentity } from "./chat-gateway-identity.ts";
import type { ChatToolScope } from "./chat-sdk-tool.ts";
import type { ImageResponseCapability } from "./chat-image-response-schema.ts";

export const createGatewayImageAdapter = (
  env: Readonly<Record<string, unknown>>,
  image: Extract<ImageResponseCapability, { state: "ready" }>,
  scope: ChatToolScope,
  onDispatch: () => void,
): NonNullable<ImageHost<unknown>["adapter"]> => ({
  async generate(_provider, model, params, _fetch, signal, inputs = []) {
    if (model !== image.model) throw new Error("Image selection changed");
    const settings = gatewayImageSettings(env, image, scope.ownerId, scope.chatId);
    const config = gatewayConfig(env);
    if (config === null) throw new Error("Image gateway unavailable");
    return withTemporaryFiles(async (files) => {
      const paths = [];
      for (const [index, original] of inputs.entries()) {
        signal?.throwIfAborted();
        paths.push(await files.input(index, original.bytes));
      }
      const pending = { pending: new Set<Promise<unknown>>() };
      const transport = gatewayImageFetch(
        config.baseUrl,
        config.inferenceKey,
        chatIdentity(env, scope.ownerId, scope.chatId).userId,
        onDispatch,
      );
      try {
        // Only controls supported by the existing app tool reach this public root call.
        const result = await generateImage(
          {
            prompt: params.prompt,
            ...(paths.length === 0 ? {} : { image: paths }),
            ...(params.size === undefined ? {} : { size: params.size }),
            ...(params.quality === undefined ? {} : { quality: params.quality }),
            ...(params.background === undefined ? {} : { background: params.background }),
            ...(params.outputFormat === undefined ? {} : { outputFormat: params.outputFormat }),
            outputDir: files.directory,
          },
          {
            cwd: files.directory,
            settings,
            ...(signal === undefined ? {} : { signal }),
            modelCapabilities: imageCapabilities(image),
            fetchImpl: (input, init) => trackImageWork(pending, () => transport(input, init)),
          },
        );
        const output = [];
        for (const [index, item] of result.images.entries()) {
          const bytes = await files.output(item.path);
          output.push({
            data: {
              kind: "base64" as const,
              bytes: Buffer.from(bytes).toString("base64"),
              mimeType: item.mimeType,
            },
            ...(item.revisedPrompt === undefined ? {} : { revisedPrompt: item.revisedPrompt }),
            // One request's accounting, never one repeated charge per output.
            ...(index !== 0 || result.metadata === undefined ? {} : { metadata: result.metadata }),
          });
        }
        return output;
      } finally {
        // SDK cancellation may settle its wait before HTTP/body work actually stops.
        await drainImageWork(pending);
      }
    });
  },
});

const imageCapabilities = (image: Extract<ImageResponseCapability, { state: "ready" }>) =>
  catalogImageRoute(image.model, image.gatewayId).capabilities;
