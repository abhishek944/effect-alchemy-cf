import { withCause } from "@starter/diagnostics";
import { Config, Effect, Layer, type Redacted, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { IntegrationError } from "./error.ts";
import { failure, postJson, validateCredential } from "./http.ts";
import { Slack, SlackMessage, SlackReceipt } from "./slack.ts";

const Response = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), ...SlackReceipt.fields }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.NonEmptyString }),
]);
// Unknown error strings are not safe log fields; retain only known machine codes.
const safeCodes = new Set([
  "invalid_auth",
  "token_revoked",
  "token_expired",
  "missing_scope",
  "channel_not_found",
  "not_in_channel",
  "no_permission",
  "is_archived",
  "msg_too_long",
  "rate_limited",
  "ratelimited",
  "internal_error",
  "service_unavailable",
]);

export interface SlackOptions {
  readonly botToken: Redacted.Redacted;
}

/** Slack Web API adapter, using chat.postMessage rather than a fixed webhook. */
const layer = (
  options: SlackOptions,
): Layer.Layer<Slack, IntegrationError, HttpClient.HttpClient> =>
  Layer.effect(
    Slack,
    Effect.gen(function* () {
      const botToken = yield* validateCredential("slack", options.botToken);
      const client = yield* HttpClient.HttpClient;
      return Slack.of({
        postMessage: Effect.fn("integrations.slack.postMessage")(function* (input: SlackMessage) {
          const message = yield* Schema.decodeUnknownEffect(SlackMessage)(input).pipe(
            Effect.mapError((cause) => withCause(failure("slack", "InvalidInput"), cause)),
          );
          const response = yield* postJson(
            client,
            "slack",
            botToken,
            "https://slack.com/api/chat.postMessage",
            {
              channel: message.channel,
              text: message.text,
              thread_ts: message.threadTs,
              mrkdwn: message.mrkdwn ?? false,
              unfurl_links: message.unfurlLinks ?? false,
              unfurl_media: message.unfurlMedia ?? false,
              parse: "none",
            },
          );
          const result = yield* Schema.decodeUnknownEffect(Response)(response.body).pipe(
            Effect.mapError((cause) =>
              withCause(failure("slack", "InvalidResponse", response.status), cause),
            ),
          );
          if (!result.ok) {
            return yield* Effect.fail(
              failure(
                "slack",
                "Rejected",
                response.status,
                response.retryAfterSeconds,
                safeCodes.has(result.error) ? result.error : "provider_rejected",
              ),
            );
          }
          return { channel: result.channel, ts: result.ts };
        }),
      });
    }),
  );

export const SlackApi = {
  layer,
  /** Evaluated only when provided, never on import or build. */
  layerConfig: Layer.unwrap(
    Config.Redacted("SLACK_BOT_TOKEN").pipe(Effect.map((botToken) => layer({ botToken }))),
  ),
};
