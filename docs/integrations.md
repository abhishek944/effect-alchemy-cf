# Integrations: low-level design

## Scope and ownership

`packages/integrations` is an opt-in, server-only workspace package. It sends
email through Cloudflare's native binding or Resend, and messages through Slack's Web API. Optional
Dodo/Polar [billing adapters](billing.md) and [setup](billing-setup.md) are documented separately.
It does not provision resources, change auth flows, expose HTTP endpoints, or
send anything on import. Consumers add `@starter/integrations: workspace:*` to
their backend package and run `pnpm install` before importing its entry points.
Browser imports by package name or relative source path are forbidden by lint.

## Components and interfaces

| Entry point                              | Contract or implementation                      |
| ---------------------------------------- | ----------------------------------------------- |
| `@starter/integrations/email`            | `Email`, `EmailMessage`, `EmailReceipt`         |
| `@starter/integrations/slack`            | `Slack`, `SlackMessage`, `SlackReceipt`         |
| `@starter/integrations/error`            | `IntegrationError` and error/provider types     |
| `@starter/integrations/resend`           | `ResendEmail.layer({ apiKey })`, `.layerConfig` |
| `@starter/integrations/cloudflare-email` | `CloudflareEmail.layer({ binding })`            |
| `@starter/integrations/slack-api`        | `SlackApi.layer({ botToken })`, `.layerConfig`  |

Business code requires `Email` or `Slack`, never a provider client or credential.
`Email.send(message)` returns `Effect<EmailReceipt, IntegrationError>`.
`Slack.postMessage(message)` returns `Effect<SlackReceipt, IntegrationError>`.
Methods need no extra environment after their layer is built. The composition
root chooses providers; HTTP adapters require Effect's `HttpClient`. Cloudflare
requires only a native `send_email` binding; see [email setup and LLD](email.md).
Explicit credentials must be Effect `Redacted` values. Missing Config credentials
fail layer acquisition with `ConfigError`; blank/malformed explicit credentials
fail with `IntegrationError` (`InvalidConfiguration`). Neither is read on import.

Replacement implementations use `Layer.succeed(Email, Email.of({ send }))` or
`Layer.succeed(Slack, Slack.of({ postMessage }))`. No adapter subclass, global
registry, provider SDK, custom runtime, or dependency injection framework is needed.
Each provider can be composed independently. Effect and its HTTP client are the
only messaging runtime dependency; billing uses pinned official provider SDKs.
The direct Effect version is pinned to `4.0.1`.

## Request and response schemas

Email requires bare-address `from`, nonempty `to`, `subject`, and nonblank `text`
or `html`. Optional fields are `cc`, `bcc`, and singular bare-address `replyTo`.
Both adapters enforce 50 combined To/CC/BCC entries and reject unknown fields.
Header fields reject CR/LF/blank values and are capped at 998 characters; each body
is capped at 1,000,000 characters. These are not provider byte-size guarantees.
Display names, quoted mailboxes, keys, attachments, and batch sends are not exposed.
Callers render templates. `EmailReceipt.id` means acceptance/tracking, not delivery.
Intentional migration: remove `idempotencyKey`, change `replyTo` arrays to one
address, remove formatted display names, and respect the aggregate recipient bound.
Domain verification and deliverability remain provider responsibilities.

Slack requires a channel ID (`C`, `D`, or `G` plus uppercase letters/digits) and
nonblank `text`, capped at 40,000 UTF-16 code units. Prefer fewer than 4,000
characters. Optional fields are `threadTs`, `mrkdwn`, `unfurlLinks`, and
`unfurlMedia`. The timestamp is a decimal string, never a floating-point number.
Markup and link/media previews default to false; `parse: none` avoids automatic
URL linking. Callers own mention/content policy; these defaults are not an input
sanitizer. Block Kit, file upload, incoming webhooks, and OAuth installation flows
are deliberately outside this initial messaging interface.
`SlackReceipt` contains the returned `channel` and message `ts`.

## Call lifecycle and provider mapping

1. Acquire the selected adapter layer and validate its credential.
2. Decode each command with its schema; malformed input fails before any request.
3. Encode JSON and POST to a fixed HTTPS provider URL with Bearer authorization.
4. Use one scoped HTTP request, aborting at scope exit and on interruption.
5. Reject non-2xx HTTP status without retaining or parsing the error body.
6. Read JSON and schema-decode the acceptance response; unknown extra fields
   are ignored, missing/invalid required fields fail as `InvalidResponse`.
7. Return the minimal receipt or a sanitized typed failure.

Resend uses `POST https://api.resend.com/emails`; singular `replyTo` maps to
`reply_to`. No idempotency header is sent through this shared interface.
Cloudflare uses a native structured binding call and maps `messageId` to `id`.
The numbered HTTP lifecycle above applies to Resend/Slack, not the native binding.

Slack uses `POST https://slack.com/api/chat.postMessage`; `threadTs` maps to
`thread_ts` and preview controls map to snake-case fields. HTTP 200 is insufficient:
`ok: false` becomes `Rejected`. Only `ok: true` with channel/timestamp is success.
Use a bot token with `chat:write`, install the app in the correct workspace, and
invite it to target channels (including private channels). Prefer explicit channel
membership over adding the broader `chat:write.public` scope.

## Failure, timeout, and retry policy

`IntegrationError` contains only `provider`, `kind`, nullable `status`, nullable
`code`, and nullable `retryAfterSeconds`. Adapters may keep the original failure
as a non-enumerable in-memory `cause`, but nothing serializes or returns it: no
raw errors, request/response objects, recipient addresses, bodies, headers or
credentials leave the server. Callers own final safe reporting.

| Kind                   | Meaning and caller action                                               |
| ---------------------- | ----------------------------------------------------------------------- |
| `InvalidConfiguration` | Credential is blank or has invalid header characters; fix setup         |
| `InvalidInput`         | Command validation/JSON encoding failed; fix input                      |
| `Transport`            | Network/redirect failure; send outcome can be unknown                   |
| `Timeout`              | 15-second deadline across request and JSON read; outcome can be unknown |
| `Http`                 | Non-2xx status; inspect status and retry delay                          |
| `InvalidResponse`      | Unreadable JSON or invalid acceptance schema; outcome can be unknown    |
| `Rejected`             | Slack `ok: false`; inspect safe machine code                            |

Known Slack error codes are allowlisted in `slack-api.ts`; unknown codes become
`provider_rejected`. Numeric `Retry-After` seconds are preserved on HTTP failures
and Slack rejections; missing, invalid, and HTTP-date values become null.
No automatic retries or provider failover are performed. Callers own reconciliation,
budgets and any deliberate resend. Respect rate limits. Neither email nor Slack
has a deduplication guarantee in this interface; a blind retry after timeout,
network failure or invalid receipt can duplicate a message. Native Cloudflare
errors use allowlisted codes; unknown errors become Transport without raw causes.
Native timeout/interruption stops waiting, not delivery; see [email details](email.md).
There is no cross-provider transaction: email can succeed while Slack fails.

Effect HTTP tracing and trace propagation are disabled inside HTTP outbound calls.
Fixed-name operation spans have no message/recipient attributes. Fetch transport
uses `redirect: error`; injected transports must preserve no-redirect behavior,
abort support, and privacy. Native platform telemetry still needs the review in
[observability.md](observability.md). Never log message payloads or unwrap tokens
for diagnostics. Scope closure aborts unread response bodies, including errors.

## Composition example

This is backend-only. Add `effect: 4.0.1` to consumers using Effect directly.
The Config example reads secrets from an application-owned ConfigProvider.

```ts
import { Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { Email } from "@starter/integrations/email";
import { Slack } from "@starter/integrations/slack";
import { ResendEmail } from "@starter/integrations/resend";
import { SlackApi } from "@starter/integrations/slack-api";

const IntegrationsLive = Layer.mergeAll(ResendEmail.layerConfig, SlackApi.layerConfig).pipe(
  Layer.provide(FetchHttpClient.layer),
);

const notify = Effect.gen(function* () {
  const email = yield* Email;
  const slack = yield* Slack;
  const receipt = yield* email.send({
    from: "notifications@your-verified-domain.example",
    to: ["recipient@example.com"],
    subject: "Example notification",
    text: "Your operation completed.",
  });
  yield* slack.postMessage({ channel: "C0123456789", text: "Operation completed." });
  return receipt;
}).pipe(Effect.provide(IntegrationsLive));
// Execute notify only inside an approved backend workflow/runtime.
```

For explicit composition, use `ResendEmail.layer({ apiKey })` and
`SlackApi.layer({ botToken })` with already-redacted credentials from your secret
boundary. Supply `FetchHttpClient.layer` in the same way. A caller needing only
email should provide only the email adapter; it needs no Slack configuration.
Worker handlers can use `Layer.provide(IntegrationsLive)` at their composition
boundary once the application actually requires these capabilities.

## Secrets and stage isolation

The optional Config layers use `RESEND_API_KEY` and `SLACK_BOT_TOKEN`. They are
not mandatory stage env keys and have not been added to `.env.dev` or `.env.prod`.
Do not put provider credentials in browser code or committed/stage env files.
Keep credentials in the appropriate private provider profile or application
secret store, then explicitly supply them via a server-only ConfigProvider or
redacted layer options. Alchemy profiles do not automatically become application
Config values; secret-to-Worker wiring is a future consumer-owned infra change.
Do not deploy that wiring without reviewing the plan and obtaining approval.

Use separate dev/prod provider credentials and Slack workspaces/channels. Use
Resend test recipients or a dedicated development sending domain. These adapters
cannot infer whether a credential belongs to production; composition owners must
never supply production resources to local/cloud development. Existing auth email
verification and password-reset callbacks remain unchanged and are not enabled.

## User-owned live verification

1. Configure only dev/test credentials and provide one adapter in a backend workflow.
2. Send one synthetic email from a verified dev domain; inspect its receipt and
   provider dashboard. Do not repeat it to infer deduplication: none is promised.
3. Post a synthetic Slack message to an invited dev channel, then reply using
   its returned `ts` as `threadTs`; confirm previews/markup defaults.
4. Confirm malformed commands fail before sending. Use a dev channel the bot
   cannot access to confirm HTTP 200 `ok: false` is a typed rejection.
5. Inspect application/native logs for payload or token leakage using synthetic
   nonsecret markers. Do not intentionally trigger rate limits on shared accounts.

No live messages, deployments, or unit tests were performed during implementation.
Run `pnpm lint` and `pnpm build` for offline verification. Update this document
with any command/receipt/error/configuration changes in the same patch.

## Provider references

- [Resend send email](https://resend.com/docs/api-reference/emails/send-email)
- [Cloudflare sending](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Slack chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/)
