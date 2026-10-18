import { Context, type Effect, Schema } from "effect";
import type { IntegrationError } from "./error.ts";

export const SlackMessage = Schema.Struct({
  channel: Schema.NonEmptyString.check(Schema.isPattern(/^[CDG][A-Z0-9]+$/)),
  text: Schema.NonEmptyString.check(
    Schema.isMaxLength(40_000),
    Schema.makeFilter((value) => value.trim().length > 0),
  ),
  threadTs: Schema.optional(Schema.String.check(Schema.isPattern(/^\d+\.\d+$/))),
  mrkdwn: Schema.optional(Schema.Boolean),
  unfurlLinks: Schema.optional(Schema.Boolean),
  unfurlMedia: Schema.optional(Schema.Boolean),
});
export type SlackMessage = typeof SlackMessage.Type;

export const SlackReceipt = Schema.Struct({
  channel: SlackMessage.fields.channel,
  ts: Schema.String.check(Schema.isPattern(/^\d+\.\d+$/)),
});
export type SlackReceipt = typeof SlackReceipt.Type;

/** Replaceable messaging capability; no Slack SDK or token in consumers. */
export class Slack extends Context.Service<
  Slack,
  { readonly postMessage: (message: SlackMessage) => Effect.Effect<SlackReceipt, IntegrationError> }
>()("starter/integrations/Slack") {}
