import { Effect, Layer, Schema } from "effect";
import { Email, EmailMessage } from "./email.ts";
import type { IntegrationError } from "./error.ts";
import { failure } from "./http.ts";

interface NativeMessage {
  readonly from: string;
  readonly to: string[];
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly cc?: string[];
  readonly bcc?: string[];
  readonly replyTo?: string;
}

/** Structural native Workers binding; platform lookup stays at the composition edge. */
export interface CloudflareEmailBinding {
  readonly send: (message: NativeMessage) => Promise<unknown>;
}

export interface CloudflareEmailOptions {
  readonly binding: CloudflareEmailBinding | undefined;
}

const Result = Schema.Struct({ messageId: Schema.NonEmptyString });
const knownCodes = new Set([
  "E_VALIDATION_ERROR",
  "E_FIELD_MISSING",
  "E_TOO_MANY_RECIPIENTS",
  "E_SENDER_NOT_VERIFIED",
  "E_RECIPIENT_NOT_ALLOWED",
  "E_RECIPIENT_SUPPRESSED",
  "E_SENDER_DOMAIN_NOT_AVAILABLE",
  "E_CONTENT_TOO_LARGE",
  "E_DELIVERY_FAILED",
  "E_RATE_LIMIT_EXCEEDED",
  "E_DAILY_LIMIT_EXCEEDED",
  "E_INTERNAL_SERVER_ERROR",
]);

const nativeFailure = (cause: unknown): IntegrationError => {
  // Never retain foreign messages/causes; even code access may be a throwing getter.
  try {
    if (typeof cause === "object" && cause !== null && "code" in cause) {
      const code = cause.code;
      if (typeof code === "string" && knownCodes.has(code)) {
        return failure("cloudflare", "Rejected", null, null, code);
      }
    }
  } catch {
    return failure("cloudflare", "Transport");
  }
  return failure("cloudflare", "Transport");
};

const layer = (options: CloudflareEmailOptions): Layer.Layer<Email, IntegrationError> =>
  Layer.effect(
    Email,
    Effect.gen(function* () {
      const binding = options.binding;
      if (binding === undefined || binding === null || typeof binding.send !== "function") {
        return yield* Effect.fail(failure("cloudflare", "InvalidConfiguration"));
      }
      return Email.of({
        send: Effect.fn("integrations.email.send")(function* (input: EmailMessage) {
          const message = yield* Schema.decodeUnknownEffect(EmailMessage, {
            onExcessProperty: "error",
          })(input).pipe(Effect.mapError(() => failure("cloudflare", "InvalidInput")));
          const result = yield* Effect.tryPromise({
            try: () =>
              binding.send({
                from: message.from,
                to: [...message.to],
                subject: message.subject,
                ...(message.text === undefined ? {} : { text: message.text }),
                ...(message.html === undefined ? {} : { html: message.html }),
                ...(message.cc === undefined ? {} : { cc: [...message.cc] }),
                ...(message.bcc === undefined ? {} : { bcc: [...message.bcc] }),
                ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
              }),
            catch: nativeFailure,
          }).pipe(
            // Deadline bounds the wait, not the native send: it cannot retract delivery.
            Effect.timeoutOrElse({
              duration: "15 seconds",
              orElse: () => Effect.fail(failure("cloudflare", "Timeout")),
            }),
          );
          const receipt = yield* Schema.decodeUnknownEffect(Result)(result).pipe(
            Effect.mapError(() => failure("cloudflare", "InvalidResponse")),
          );
          return { id: receipt.messageId };
        }),
      });
    }),
  );

/** No token, HTTP client, Config reads, retries or sends during layer acquisition. */
export const CloudflareEmail = { layer };
