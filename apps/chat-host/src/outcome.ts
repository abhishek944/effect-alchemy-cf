import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { HostDiagnostic, SettledEvent } from "@highchat/chat-runtime";
import { hostOutcomeDiagnostic } from "./diagnostics.ts";

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

export const settledEvent = (input: {
  readonly stopped: boolean;
  readonly channelLost: boolean;
  readonly modelRequested: boolean;
  readonly final: AssistantMessage | undefined;
  readonly error: string | undefined;
  readonly exception: HostDiagnostic | undefined;
}): SettledEvent => {
  // Only explicit Stop reports stopped; lost channels and failures remain unanswered.
  if (input.stopped) return { type: "settled", status: "stopped" };
  const reason = input.channelLost
    ? "Run channel lost"
    : unansweredReason(input.final, input.error);
  return reason === undefined
    ? { type: "settled", status: "answered" }
    : {
        type: "settled",
        status: "unanswered",
        error: reason,
        diagnostic: hostOutcomeDiagnostic(input),
      };
};
