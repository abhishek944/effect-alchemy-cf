import { Context, type Effect, Schema } from "effect";
import type { IntegrationError } from "./error.ts";

const HeaderText = Schema.NonEmptyString.check(
  Schema.isMaxLength(998),
  Schema.isPattern(/^[^\r\n]+$/),
  Schema.makeFilter((value) => value.trim().length > 0),
);
// Deliberately simple bare addresses; quoted mailboxes and display names are not exposed.
const Address = HeaderText.check(
  Schema.isPattern(/^[^\s<>@,;"\\]+@[^\s<>@,;"\\]+\.[^\s<>@,;"\\]+$/),
);
const Recipients = Schema.Array(Address).check(Schema.isBetweenLength(1, 50));
const Body = Schema.NonEmptyString.check(
  Schema.isMaxLength(1_000_000),
  Schema.makeFilter((value) => value.trim().length > 0),
);

/** Portable subset: format addresses and render templates before calling send. */
export const EmailMessage = Schema.Struct({
  from: Address,
  to: Recipients,
  subject: HeaderText,
  text: Schema.optional(Body),
  html: Schema.optional(Body),
  cc: Schema.optional(Recipients),
  bcc: Schema.optional(Recipients),
  replyTo: Schema.optional(Address),
}).check(
  Schema.makeFilter((value) => value.text !== undefined || value.html !== undefined),
  Schema.makeFilter(
    (value) => value.to.length + (value.cc?.length ?? 0) + (value.bcc?.length ?? 0) <= 50,
  ),
);
export type EmailMessage = typeof EmailMessage.Type;

export const EmailReceipt = Schema.Struct({ id: Schema.NonEmptyString });
export type EmailReceipt = typeof EmailReceipt.Type;

/** Business code depends on Email, not provider bindings or credentials. No deduplication guarantee. */
export class Email extends Context.Service<
  Email,
  { readonly send: (message: EmailMessage) => Effect.Effect<EmailReceipt, IntegrationError> }
>()("starter/integrations/Email") {}
