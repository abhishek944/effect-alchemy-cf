import { Context, Layer } from "effect";

/**
 * The host process environment record. Replaces the Cloudflare Worker binding
 * record: bindings arrive as plain values, so callers keep their own runtime
 * guards instead of trusting an asserted shape.
 */
export class RuntimeEnv extends Context.Service<RuntimeEnv, Readonly<Record<string, unknown>>>()(
  "highchat/RuntimeEnv",
) {}

export const runtimeEnvLayer = (env: Readonly<Record<string, unknown>>): Layer.Layer<RuntimeEnv> =>
  Layer.succeed(RuntimeEnv, env);
