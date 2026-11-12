import { createHash } from "node:crypto";
import type { ImageGenSettings } from "@abhishek944/pi-image-gen";
import {
  catalogImageRoute,
  CATALOG_MODELS,
  type ProviderImageRoute,
} from "@abhishek944/pi-image-gen/core";
import { gatewayConfig } from "./chat-gateway-config.ts";
import { gatewayCatalogSnapshot } from "./chat-gateway-catalog.ts";
import { chatIdentity } from "./chat-gateway-identity.ts";
import type { ImageResponseCapability } from "./chat-image-response-schema.ts";

type ReadyImage = Extract<ImageResponseCapability, { state: "ready" }>;
export const imageGatewayId = (
  env: Readonly<Record<string, unknown>>,
  model?: string,
): string | null => {
  const config = gatewayConfig(env);
  return config === null ||
    !CATALOG_MODELS.some(
      (id) =>
        (model === undefined || model === id) && gatewayCatalogSnapshot().imageIds.includes(id),
    )
    ? null
    : createHash("sha256")
        .update(JSON.stringify([config.stage, config.baseUrl, "images-v1"]))
        .digest("hex");
};
export const gatewayImageReady = (
  env: Readonly<Record<string, unknown>>,
  image: ReadyImage,
): boolean =>
  image.gatewayId === imageGatewayId(env) &&
  gatewayCatalogSnapshot().imageIds.includes(image.model);

/** Request-private settings; no direct, discovery, fallback or comparison route exists. */
export const gatewayImageSettings = (
  env: Readonly<Record<string, unknown>>,
  image: ReadyImage,
  ownerId: string,
  chatId: string,
): ImageGenSettings => {
  const config = gatewayConfig(env);
  if (config === null || !gatewayImageReady(env, image))
    throw new Error("Image gateway unavailable");
  return {
    defaultProvider: "litellm",
    defaultModel: image.model,
    openRouterDiscovery: false,
    customProviders: {
      litellm: {
        api: "openai",
        baseUrl: new URL("/v1", config.baseUrl).href,
        apiKey: config.inferenceKey,
        models: [
          {
            id: image.model,
            capabilities: catalogImageRoute(image.model, image.gatewayId).capabilities,
          },
        ],
        headers: { "x-litellm-customer-id": chatIdentity(env, ownerId, chatId).userId },
      },
    },
  };
};

/** Only public canonical fields enter receipts; credentials are supplied to the SDK separately. */
export const gatewayImageRoute = (image: ReadyImage): ProviderImageRoute => ({
  kind: "provider",
  requestedId: image.model,
  remoteModelId: image.model,
  provider: { id: "litellm", api: "openai", baseUrl: "", name: "LiteLLM", builtIn: false },
  capabilities: catalogImageRoute(image.model, image.gatewayId).capabilities,
});
