import { ModelsError, type AssistantMessage } from "@earendil-works/pi-ai";
import type { HostDiagnostic } from "@highchat/chat-runtime";

/** Match installed SDK contracts in memory; unknown foreign text is always discarded. */
const sdkReason = (message: string | undefined): HostDiagnostic["reason"] => {
  if (message?.startsWith("Invalid tools option:")) return "sdk_tools";
  if (
    message?.startsWith("No API key found for ") ||
    message?.startsWith("Provider is not configured:") ||
    message?.startsWith("API key auth failed for provider ")
  )
    return "sdk_auth";
  if (message?.startsWith("Unknown provider:")) return "sdk_provider";
  return "sdk_error";
};

export const hostExceptionDiagnostic = (
  error: unknown,
  phase: "session" | "prompt",
): HostDiagnostic => ({
  phase,
  reason:
    error instanceof ModelsError && (error.code === "auth" || error.code === "oauth")
      ? "sdk_auth"
      : error instanceof ModelsError && error.code === "provider"
        ? "sdk_provider"
        : sdkReason(error instanceof Error ? error.message : undefined),
});

export const hostOutcomeDiagnostic = (input: {
  readonly final: AssistantMessage | undefined;
  readonly exception: HostDiagnostic | undefined;
  readonly channelLost: boolean;
  readonly modelRequested: boolean;
}): HostDiagnostic => {
  if (input.channelLost) return { phase: "channel", reason: "channel_lost" };
  if (input.exception) return input.exception;
  const final = input.final;
  if (
    !final ||
    ((final.stopReason === "stop" || final.stopReason === "length") && !final.content.length)
  )
    return { phase: "outcome", reason: "no_output" };
  if (final.stopReason === "error")
    return {
      phase: "model",
      reason: input.modelRequested ? "model_failed" : sdkReason(final.errorMessage),
    };
  if (final.stopReason === "aborted") return { phase: "model", reason: "model_aborted" };
  return {
    phase: "outcome",
    reason: final.stopReason === "deferred" ? "deferred" : "unfinished",
  };
};
