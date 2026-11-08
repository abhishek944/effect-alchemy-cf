import type { AssistantMessage } from "@earendil-works/pi-ai";

/**
 * Classifies a finished run from its last finalized assistant message.
 *
 * A run answers only when that message is a real terminal answer: a `stop` or
 * `length` response with content. The SDK can resolve `prompt()` normally on a
 * provider failure, so an errored or aborted final message — and a run whose last
 * message only requested more tools — is not success. Returns undefined when the
 * run did answer, otherwise the reason the Worker should surface.
 */
export const unansweredReason = (
  final: AssistantMessage | undefined,
  error: string | undefined,
): string | undefined => {
  if (error !== undefined) return error;
  if (final === undefined) return "Run produced no assistant output";
  if (final.stopReason === "stop" || final.stopReason === "length") {
    return final.content.length > 0 ? undefined : "Run produced no assistant output";
  }
  if (final.stopReason === "error" || final.stopReason === "aborted") {
    return final.errorMessage ?? "Model request failed";
  }
  if (final.stopReason === "deferred") return "Run ended with a deferred response";
  if (final.stopReason === "toolUse") return "Run ended without a final assistant answer";
  return "Run ended with an unfinished assistant message";
};
