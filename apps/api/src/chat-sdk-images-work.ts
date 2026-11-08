/**
 * Real-work tracking and trusted output destinations for one image call.
 *
 * Cancellation settles the caller but never abandons provider/body/storage work:
 * tracked work is drained before the call is finalized. Only AI Gateway's own
 * object-storage hosts may be fetched for provider output; nothing else is.
 */

export type ImageWorkTracker = {
  readonly pending: Set<Promise<unknown>>;
  readonly responses: Set<Response>;
};

export const trackImageWork = <T>(
  runtime: Pick<ImageWorkTracker, "pending">,
  work: () => Promise<T>,
): Promise<T> => {
  const actual = Promise.resolve().then(work);
  runtime.pending.add(actual);
  void actual.then(
    () => runtime.pending.delete(actual),
    () => runtime.pending.delete(actual),
  );
  return actual;
};

export const drainImageWork = async (runtime: Pick<ImageWorkTracker, "pending">): Promise<void> => {
  while (runtime.pending.size > 0) await Promise.allSettled(runtime.pending);
};

export const cancelImageResponses = async (
  runtime: Pick<ImageWorkTracker, "responses">,
): Promise<void> => {
  for (const response of runtime.responses) {
    if (response.body !== null && !response.body.locked)
      await response.body.cancel().catch(() => undefined);
  }
};

/** Fixed refusal used for every authorization or frozen-state mismatch. */
export class ChatImageRefusal extends Error {
  constructor() {
    super("The image call could not be authorized.");
    this.name = "ChatImageRefusal";
  }
}

const GATEWAY_OUTPUT_HOST_PREFIX = "ai-gateway-outputs.";
const GATEWAY_OUTPUT_HOST_SUFFIX = ".r2.cloudflarestorage.com";

/** https-only allowlist for Gateway-minted output links; every other URL stays refused. */
export const safeGatewayOutputUrl = (value: string): URL | null => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  const host = parsed.hostname.toLowerCase();
  return host.startsWith(GATEWAY_OUTPUT_HOST_PREFIX) && host.endsWith(GATEWAY_OUTPUT_HOST_SUFFIX)
    ? parsed
    : null;
};
