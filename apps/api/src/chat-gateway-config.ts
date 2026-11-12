import { Option, Schema } from "effect";

const Nonblank = Schema.String.check(Schema.isMinLength(1));
const Gateway = Schema.Struct({
  enabled: Schema.Literal("true"),
  baseUrl: Nonblank,
  inferenceKey: Nonblank,
  identitySecret: Nonblank,
  stage: Schema.Literals(["dev", "prod"]),
});
export type GatewayConfig = typeof Gateway.Type;

/** Server-only values; no credentials or endpoint may be supplied by a chat request. */
export const gatewayConfig = (env: Readonly<Record<string, unknown>>): GatewayConfig | null => {
  const value = Option.getOrNull(
    Schema.decodeUnknownOption(Gateway)({
      enabled: env.LITELLM_ENABLED,
      baseUrl: env.LITELLM_BASE_URL,
      inferenceKey: env.LITELLM_INFERENCE_KEY,
      identitySecret: env.CHAT_IDENTITY_SECRET,
      stage: env.APP_STAGE ?? "dev",
    }),
  );
  return value !== null &&
    value.inferenceKey.trim() &&
    value.identitySecret.trim() &&
    gatewayOrigin(env) !== null
    ? value
    : null;
};

export const gatewayOrigin = (env: Readonly<Record<string, unknown>>): string | null => {
  if (typeof env.LITELLM_BASE_URL !== "string") return null;
  try {
    const url = new URL(env.LITELLM_BASE_URL);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return url.origin;
  } catch {
    return null;
  }
};
