import type { ClassifierSettings } from "@abhishek944/pi-classifier";
import { Option, Schema } from "effect";
import { gatewayConfig } from "./chat-gateway-config.ts";
import { gatewayCatalogSnapshot } from "./chat-gateway-catalog.ts";
import { chatIdentity } from "./chat-gateway-identity.ts";

const Selection = Schema.Struct({
  model: Schema.String.check(Schema.isMinLength(1), Schema.isTrimmed()),
  api: Schema.Literals(["openai-decisions", "system-one"]),
});
export const classifierConfig = (env: Readonly<Record<string, unknown>>) =>
  gatewayConfig(env) === null
    ? null
    : Option.getOrNull(
        Schema.decodeUnknownOption(Selection)({
          model: env.LITELLM_CLASSIFIER_MODEL,
          api: env.LITELLM_CLASSIFIER_API,
        }),
      );
export const gatewayClassifierSelection = (env: Readonly<Record<string, unknown>>) => {
  if (!gatewayCatalogSnapshot().available) return null;
  const selection = classifierConfig(env);
  return selection !== null && gatewayCatalogSnapshot().permittedIds.includes(selection.model)
    ? selection
    : null;
};

/** Explicit, request-private credentials/headers; no store, direct fallback, pricing guess or compare. */
export const gatewayClassifierSettings = (
  env: Readonly<Record<string, unknown>>,
  ownerId: string,
  chatId: string,
): ClassifierSettings => {
  const config = gatewayConfig(env);
  const selection = gatewayClassifierSelection(env);
  if (config === null || selection === null) throw new Error("Classifier unavailable");
  return {
    default: { provider: "litellm", model: selection.model },
    fallback: [],
    compare: [],
    customProviders: {
      litellm: {
        api: selection.api,
        baseUrl: new URL("/v1", config.baseUrl).href,
        apiKey: config.inferenceKey,
        models: [{ id: selection.model, input: ["text"] }],
        headers: { "x-litellm-customer-id": chatIdentity(env, ownerId, chatId).userId },
      },
    },
  };
};
