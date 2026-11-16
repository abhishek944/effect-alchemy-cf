import { Option, Schema } from "effect";
import { reportFailure, type FailureContext } from "@highchat/diagnostics";
import type { HostDiagnostic } from "@highchat/chat-runtime";

export const reportHostDiagnostic = (
  diagnostic: HostDiagnostic | undefined,
  metadata: Pick<FailureContext, "service" | "stage" | "release">,
  operationId: string,
): void => {
  // Provider terminal failures are already reported once by their transport owner.
  if (!diagnostic || diagnostic.reason === "model_failed") return;
  reportFailure(undefined, {
    service: metadata.service,
    stage: metadata.stage,
    release: metadata.release,
    component: "chat-sdk",
    operation: "run",
    provider: "highchat-transport",
    phase: diagnostic.phase,
    reason: diagnostic.reason,
    operationId,
    outcome: diagnostic.reason === "channel_lost" ? "unknown" : "failed",
  });
};

const ProviderError = Schema.Struct({
  error: Schema.Struct({
    code: Schema.optional(Schema.Unknown),
    type: Schema.optional(Schema.Unknown),
  }),
});
const providerReason = (value: unknown): string | undefined => {
  switch (value) {
    case "invalid_api_key":
    case "authentication_error":
      return "authentication_rejected";
    case "permission_error":
    case "permission_denied":
      return "permission_rejected";
    case "rate_limit_exceeded":
    case "rate_limit_error":
      return "rate_limited";
    case "insufficient_quota":
      return "quota_rejected";
    case "context_length_exceeded":
      return "context_rejected";
    case "invalid_image":
    case "invalid_image_format":
    case "invalid_base64_image":
    case "invalid_image_url":
    case "image_too_large":
    case "image_too_small":
    case "image_parse_error":
    case "invalid_image_mode":
      return "image_rejected";
    case "invalid_request_error":
    case "bad_request_error":
      return "request_rejected";
    case "server_error":
    case "api_error":
    case "overloaded_error":
      return "upstream_failed";
    default:
      return undefined;
  }
};
const httpReason = (status: number): string => {
  if (status === 401) return "authentication_rejected";
  if (status === 403) return "permission_rejected";
  if (status === 413) return "payload_rejected";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_failed";
  return "http_rejected";
};

/** Per-request observer: preserve the native Response; never retain foreign data. */
export const modelDiagnostics = (context: {
  readonly protocol: string;
  readonly metadata: Pick<FailureContext, "service" | "stage" | "release">;
  readonly requestId: string;
  readonly operationId: string;
}) => {
  let status: number | undefined;
  let reason: string | undefined;
  let transportFailed = false;
  let started = false;
  let reported = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    let response: Response;
    started = true;
    try {
      response = await globalThis.fetch(input, init);
    } catch (error) {
      transportFailed = true;
      throw error;
    }
    status = response.status;
    if (!response.ok) {
      reason = httpReason(status);
      try {
        // Only non-2xx JSON errors; no successful/SSE body or headers are read.
        const raw: unknown = await response.clone().json();
        const parsed = Option.getOrNull(Schema.decodeUnknownOption(ProviderError)(raw));
        if (parsed !== null)
          reason = providerReason(parsed.error.code) ?? providerReason(parsed.error.type) ?? reason;
      } catch {
        // Malformed/non-JSON errors retain status-only evidence, not body text.
      }
    }
    return response;
  };
  return {
    fetch,
    terminalFailure: () => {
      if (reported) return;
      reported = true;
      reportFailure(undefined, {
        service: context.metadata.service,
        stage: context.metadata.stage,
        release: context.metadata.release,
        component: "chat-sdk",
        operation: "model",
        requestId: context.requestId,
        operationId: context.operationId,
        provider:
          context.protocol === "openai-responses"
            ? "openai-responses"
            : context.protocol === "anthropic-messages"
              ? "anthropic-messages"
              : "unknown",
        phase:
          status === undefined
            ? started
              ? "transport"
              : "prepare"
            : status >= 300
              ? "http"
              : "stream",
        reason:
          reason ??
          (transportFailed
            ? "transport_failed"
            : status === undefined
              ? "failed_before_response"
              : "provider_stream_failed"),
        status,
        outcome: transportFailed ? "unknown" : "failed",
      });
    },
  };
};
