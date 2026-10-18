# Email: provider-neutral sending

## Contract and low-level design

`@starter/integrations/email` owns the schema and Effect `Email` service.
Business code calls `Email.send(message): Effect<EmailReceipt, IntegrationError>`.
Methods have no platform/configuration requirements after their layer is built.
Backend composition selects one provider; there is no registry, `EMAIL_PROVIDER`
selector, automatic fallback, or user-facing provider setting.

| Module                    | Responsibility / dependencies                                              |
| ------------------------- | -------------------------------------------------------------------------- |
| `email`                   | Bare-address command schema, aggregate recipient bound, acceptance receipt |
| `cloudflare-email`        | Native binding call, safe error translation, messageId mapping; no token   |
| `resend`                  | Fixed HTTPS request, redacted API key, reply_to mapping; Effect HttpClient |
| `error` / internal `http` | Sanitized failure metadata and HTTP lifecycle for HTTP adapters            |

The shared schema requires `from`, a nonempty `to` array, `subject`, and nonblank
`text` or `html`. `cc` and `bcc` are optional arrays; `replyTo` is one optional
address. All addresses must be simple bare strings such as `person@example.com`.
Display names, quoted mailboxes, attachments, headers and batch sends are outside
this interface. To+CC+BCC may contain at most 50 entries in total. Caller-owned
rendering supplies plain text/HTML. Character bounds do not guarantee provider
encoded byte-size limits; Cloudflare normally caps a message at 5 MiB.

**Compatibility change:** the former Resend-only `idempotencyKey` is removed from
the shared schema and forwarding. `replyTo` changes from array to string; formatted
display names and >50 combined recipients are invalid. Both adapters reject excess
command fields before sending, including obsolete keys. There is no separate key
API or deduplication guarantee. Existing code using those fields must be migrated.

## Cloudflare composition (preferred Worker example)

Add the server-only workspace dependency `@starter/integrations: workspace:*` to
a consumer and install with pnpm. Supply a native binding from that consumer's
Worker environment. This adapter neither provisions resources nor reads env itself.

```ts
import { Effect } from "effect";
import { Email } from "@starter/integrations/email";
import { CloudflareEmail } from "@starter/integrations/cloudflare-email";
import type { CloudflareEmailBinding } from "@starter/integrations/cloudflare-email";

const notification = (env: { EMAIL: CloudflareEmailBinding }) =>
  Effect.gen(function* () {
    const email = yield* Email;
    return yield* email.send({
      from: "notifications@dev.your-domain.example",
      to: ["recipient@example.com"],
      subject: "Operation completed",
      text: "Your operation completed.",
      replyTo: "support@dev.your-domain.example",
    });
  }).pipe(Effect.provide(CloudflareEmail.layer({ binding: env.EMAIL })));
// Execute notification only in an approved backend workflow/runtime.
```

`CloudflareEmail.layer({ binding })` returns `Layer<Email, IntegrationError>`.
It validates binding presence/method without calling send. A missing binding fails
acquisition with `InvalidConfiguration`. It invokes native `send` exactly once per
validated command, validates `{messageId}`, and returns `{id: messageId}`. Neither
import nor layer acquisition sends mail. The structural binding interface avoids
coupling the reusable package to Alchemy or a provider SDK.

Alchemy `2.0.0-beta.80` already supports `Cloudflare.Email.SendEmail` descriptors and
`Cloudflare.Email.Send` binding attachment. A future application consumer should
register its descriptor at its platform boundary and resolve the raw binding only
inside a runtime context: planning-time Worker bindings may not exist. Keep
Alchemy's `RuntimeContext` requirement at that composition edge, not on Email.send.
The package does not install a binding into this application's otherwise unused
email path. Do not add Wrangler configuration to an Alchemy-managed deployment.
Review the actual infrastructure plan and obtain approval before deployment.

## Resend composition

The same business effect can instead receive `ResendEmail.layer({ apiKey })`, where
`apiKey` is Effect `Redacted`. Provide `FetchHttpClient.layer` to that adapter:

```ts
import { Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { ResendEmail } from "@starter/integrations/resend";

const ResendLive = ResendEmail.layerConfig.pipe(Layer.provide(FetchHttpClient.layer));
// Provide ResendLive instead of the Cloudflare layer at the backend boundary.
```

`layerConfig` reads `RESEND_API_KEY` lazily from the consumer's server-only
ConfigProvider. Missing config fails acquisition with ConfigError; malformed
explicit tokens fail InvalidConfiguration. Keep credentials in private profiles or
an approved secret store, not stage env files/browser code. Profile values do not
automatically become application Config. Only the selected provider needs setup:
Cloudflare needs no Resend key or HttpClient; Resend needs no Cloudflare binding.

## Failure and concurrency policy

- Every call validates before sending; invalid commands fail `InvalidInput`.
- Native documented error codes are allowlisted into `Rejected`; unknown failures
  become `Transport`. No raw causes/messages, recipients, bodies or tokens escape.
- Invalid native receipts fail `InvalidResponse`; HTTP policy is in
  [integrations.md](integrations.md). No transport/client error is delivery proof.
- Both adapters bound their wait to 15 seconds. Native cancellation/timeout cannot
  retract a send; the binding API has no AbortSignal contract. Concurrent callers
  are independent; there is no ordering, transaction, queue or shared dedupe state.
- Timeout, transport failure or an invalid receipt can leave acceptance unknown.
  Do not automatically retry or switch providers; duplicates can result. Callers
  must explicitly decide how to reconcile an unknown outcome.
- `{id}` is provider acceptance/tracking only, not proof every recipient received
  the message or that it reached an inbox. Cloudflare may later retry soft bounces;
  those delivery retries are distinct from another application submission.
- No generic email HTTP endpoint, auth callback, delivery webhook, ledger or UI is
  enabled by adding these opt-in adapters. Slack and billing remain unchanged.

## Setup, privacy and user-owned live verification

1. Cloudflare Email Sending is beta. Arbitrary recipients require Workers Paid;
   verified destinations have a separate free sending path. Confirm account
   entitlement and quota. Onboard a sending domain using Cloudflare DNS; do not
   change existing mailbox MX records merely to enable outbound sending.
2. Use separate dev/prod sender domains/resources. Restrict senders and deliberately
   choose dev recipients. Verify exact allowed-destination behavior against your
   account; provider docs have differing verified-destination wording. Never point
   development at production resources. Local Alchemy simulation is not inbox
   delivery; real remote sending needs an explicit, approved dev configuration.
3. Review provider-side Email preview, which defaults on for new Cloudflare domains
   and can retain sent contents for about seven days. Sanitized application logging
   does not prevent provider storage. Review suppression policy too: enabling
   dropping may omit suppressed recipients. No account settings are changed here.
4. After approved isolated dev setup, send one synthetic plain-text message. Check
   receipt and provider dashboard/inbox separately. Do not infer deduplication or
   delivery guarantees by repeating the request. Never expose message bodies in logs.
5. Exercise consumer missing-config and invalid-input paths before real sending.
   Run `pnpm lint` and `pnpm build` for offline verification. Actual entitlement,
   binding deployment, rejection codes and delivery need this user-owned live check.

## Official references

- [Cloudflare Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Cloudflare limits](https://developers.cloudflare.com/email-service/platform/limits/)
- [Cloudflare domain settings](https://developers.cloudflare.com/email-service/configuration/domains/)
- [Cloudflare send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Cloudflare pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Resend send API](https://resend.com/docs/api-reference/emails/send-email)
