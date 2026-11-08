import type { Provider } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

/**
 * Whether this process can actually run model work. One predicate, used both by
 * the conversation that enables submission and by the send route that refuses to
 * admit and reserve quota for work that could never run.
 */
export const chatInferenceConfigured = (env: Readonly<Record<string, unknown>>): boolean => {
  const key = env.OPENROUTER_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
};

/**
 * The one model transport this local runtime supports. It is an HTTP provider
 * SDK call, never a platform binding, and it exists only when the deployment
 * supplies its credential: with no key configured, inference stays unavailable
 * instead of silently falling back to a different provider.
 */
export const configuredChatProvider = (env: Readonly<Record<string, unknown>>): Provider | null =>
  chatInferenceConfigured(env) ? openrouterProvider() : null;

/** Paid image generation needs its own configured provider transport; none is installed. */
export const imageTransportConfigured = (): boolean => false;
