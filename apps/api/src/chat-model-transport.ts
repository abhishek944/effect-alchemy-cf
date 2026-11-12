import type { Provider } from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai/models";
import * as anthropic from "@earendil-works/pi-ai/api/anthropic-messages";
import * as responses from "@earendil-works/pi-ai/api/openai-responses";
import { gatewayModelMetadata } from "./chat-gateway-models.ts";
import { gatewayConfig } from "./chat-gateway-config.ts";
import { gatewayCatalogSnapshot } from "./chat-gateway-catalog.ts";
import { imageGatewayId } from "./chat-gateway-images.ts";

/** Same fail-closed predicate at ingress and conversation admission; never a direct bypass. */
export const chatInferenceConfigured = (env: Readonly<Record<string, unknown>>): boolean =>
  gatewayConfig(env) !== null && gatewayCatalogSnapshot().available;

/** Historical provider ID preserves saved selections; every HTTP endpoint is now the gateway. */
export const configuredChatProvider = (env: Readonly<Record<string, unknown>>): Provider | null => {
  const config = gatewayConfig(env);
  if (config === null) return null;
  return createProvider({
    id: "openrouter",
    name: "LiteLLM",
    headers: { authorization: `Bearer ${config.inferenceKey}` },
    baseUrl: new URL("/v1", config.baseUrl).href,
    auth: {
      apiKey: {
        name: "LiteLLM inference",
        resolve: async () => ({
          auth: { apiKey: config.inferenceKey },
          source: "environment",
        }),
      },
    },
    models: gatewayModelMetadata.map((model) => ({
      ...model,
      baseUrl: new URL("/v1", config.baseUrl).href,
    })),
    api: {
      "openai-responses": { stream: responses.stream, streamSimple: responses.streamSimple },
      "anthropic-messages": { stream: anthropic.stream, streamSimple: anthropic.streamSimple },
    },
  });
};

/** Only the existing image catalog models with verified gateway mappings can activate. */
export const imageTransportConfigured = (): boolean => imageGatewayId(process.env) !== null;
