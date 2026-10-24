import { withCause } from "@starter/diagnostics";
import { Config, Effect, Layer, type Redacted, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { Email, EmailMessage, EmailReceipt } from "./email.ts";
import type { IntegrationError } from "./error.ts";
import { failure, postJson, validateCredential } from "./http.ts";

export interface ResendOptions {
  readonly apiKey: Redacted.Redacted;
}

/** Supplies Email; the composition root supplies HttpClient separately. */
const layer = (
  options: ResendOptions,
): Layer.Layer<Email, IntegrationError, HttpClient.HttpClient> =>
  Layer.effect(
    Email,
    Effect.gen(function* () {
      const apiKey = yield* validateCredential("resend", options.apiKey);
      const client = yield* HttpClient.HttpClient;
      return Email.of({
        send: Effect.fn("integrations.email.send")(function* (input: EmailMessage) {
          const message = yield* Schema.decodeUnknownEffect(EmailMessage, {
            onExcessProperty: "error",
          })(input).pipe(
            Effect.mapError((cause) => withCause(failure("resend", "InvalidInput"), cause)),
          );
          const response = yield* postJson(
            client,
            "resend",
            apiKey,
            "https://api.resend.com/emails",
            {
              from: message.from,
              to: message.to,
              subject: message.subject,
              text: message.text,
              html: message.html,
              cc: message.cc,
              bcc: message.bcc,
              reply_to: message.replyTo,
            },
          );
          return yield* Schema.decodeUnknownEffect(EmailReceipt)(response.body).pipe(
            Effect.mapError((cause) =>
              withCause(failure("resend", "InvalidResponse", response.status), cause),
            ),
          );
        }),
      });
    }),
  );

export const ResendEmail = {
  layer,
  /** Evaluated only when provided, never on import or build. */
  layerConfig: Layer.unwrap(
    Config.Redacted("RESEND_API_KEY").pipe(Effect.map((apiKey) => layer({ apiKey }))),
  ),
};
