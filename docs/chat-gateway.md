# LiteLLM and Langfuse operator prerequisites

This wiring does not itself provision services, accounts, credentials or stage
configuration. Source checks, health probes and discovery do not prove live
inference. The existing local Node API and private Pi host remain the runtime.

## Server configuration

Inject all values through Doppler project `effect-boilerplate`, `dev` or `prd`.
`APP_STAGE` is `dev` or `prod` (`prd` is the Doppler configuration name). Never use
stage env files, browser variables, global Pi settings or model-owned configuration.
The local launcher preserves injected values instead of blanking provider keys or
loading a private profile. Public branding and `pk_` Clerk keys are unchanged.

| Name                         | Purpose                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `LITELLM_ENABLED`            | Exactly `true` enables configured gateway inference; otherwise off.                                  |
| `LITELLM_BASE_URL`           | Gateway origin, HTTPS except loopback HTTP; no `/v1` suffix.                                         |
| `LITELLM_INFERENCE_KEY`      | Operator-owned, stage-specific permitted inference credential.                                       |
| `CHAT_IDENTITY_SECRET`       | Stable private HMAC material for per-chat conversation correlation only; never derives user IDs.     |
| `LITELLM_REPORT_KEY`         | Distinct supported admin/admin-viewer reporting credential, never an inference/master fallback.      |
| `LITELLM_INFERENCE_KEY_ID`   | Exact persisted current inference-key identity used by the report filter, not the report credential. |
| `LITELLM_USAGE_ACTIVATED_ON` | Canonical UTC `YYYY-MM-DD` start of attributed usage; no historical backfill.                        |
| `LITELLM_REPORT_KEY_WINDOWS` | JSON key-coverage windows described below; no browser-supplied key mapping.                          |
| `LITELLM_CLASSIFIER_MODEL`   | Exact operator-provisioned, inference-key-permitted decision model alias; absent disables classify.  |
| `LITELLM_CLASSIFIER_API`     | Exactly `openai-decisions` or `system-one`, matching the native gateway wire API.                    |
| `LANGFUSE_ENABLED`           | Exactly `true` opts in to configured metadata-only tracing.                                          |
| `LANGFUSE_BASE_URL`          | Explicit approved Langfuse destination; no ambient fallback.                                         |
| `LANGFUSE_PUBLIC_KEY`        | Stage project's public API credential; server-only despite its name.                                 |
| `LANGFUSE_SECRET_KEY`        | Same stage project's private credential.                                                             |

Use different dev/prd inference keys and Langfuse projects/credentials. A shared
LiteLLM gateway and shared Langfuse server are supported; gateway administrators can
see combined stages. Application filtering is not isolation from those operators.
Never rotate `CHAT_IDENTITY_SECRET` casually: it preserves stage/owner/chat trace
conversation correlation. User attribution is the unchanged verified Clerk UID,
shared as explicitly authorized; it is not pseudonymized or stage-prefixed.
Stage-specific keys/report filters and Langfuse projects retain stage isolation.

## Report-key coverage

`LITELLM_REPORT_KEY_WINDOWS` is an array of objects with `apiKey` (one exact
persisted inference-key identity), `start` (inclusive UTC date), and `end` (inclusive
date or `null` for current). At least the current identity must have an open window.
Each identity's windows must be disjoint. Different identities can overlap because
multiple actual keys can serve traffic in one day. Retain old identities through
rotation; start the new window when it actually begins attribution. Missing periods
are Partial/Unavailable. Never substitute a comma-separated list or omit the filter.

Every request to pinned LiteLLM 1.108.4 core customer aggregation forces both
`end_user_ids` and `api_key`; empty filters would mean ALL and are refused. Report
access is independent of inference enablement. Missing credentials/roles/mapping or
invalid responses yield Unavailable, not zero or local estimated totals. The backend
splits periods into nonoverlapping vendor-legal intervals (difference <=400 days).

Operators must ensure complete key coverage, actual pricing and usage logging;
source-level validation cannot prove those facts. Zero reported usage is distinct
from unavailable data, and missing metric fields remain Unknown/Partial. Aggregate
zero spend with actual attempts cannot distinguish free work from absent pricing;
that spend remains Unknown while independently known token/request counts survive.
Only pinned canonical model/provider identities are returned; private/unknown aliases
become Unknown rather than leaking operator labels.

## Gateway model contract

Allow the inference key read-only `/v1/models` and appropriately scoped `/model/info`
discovery. Configure exact canonical `openai/<native-id>` or
`anthropic/<native-id>` mappings to the same underlying canonical model. Native Pi
1.2.0 metadata supplies known protocol, tools/vision, capacity, pricing and efforts;
unknown models/mappings are not guessed or added through a manual app allowlist.
Confirm gateway Responses and Anthropic endpoint support for each selected mapping.
Do not configure auto-routing, alternate-model fallbacks, parameter dropping or paid
retries. These operator settings are prerequisites, not provisioned by the app.
The API owns inference HTTP; the private host receives no provider credential.

The trusted API overwrites `x-litellm-customer-id` with the unchanged verified Clerk
UID. OpenAI-shaped payloads receive that exact UID as `user`, applied last; no hash,
prefix, encoding, truncation, normalization or assumed fixed UID length is used.
LiteLLM 1.108.4 checks the customer header before body `user` for end-user attribution.
Anthropic uses the recognized customer header, not an unsupported top-level `user`.
Actual provider field constraints still apply; IDs are never rewritten to fit them.
The browser/model/host cannot select customer, stage, endpoint or key. In-flight
work retains its accepted owner across browser account changes.

The same raw UID scopes own-user usage and trace user labels. Existing hashed-user
records are not automatically joined to raw-UID records; there is no backfill,
historical rewrite or legacy fallback. Local chat ownership already uses Clerk UIDs,
so this attribution switch needs no database migration. Conversation correlation
remains a separate per-chat HMAC; never use the user UID as a conversation ID.

## Images and classification

Images use the existing pi-image-gen 0.6.0 public root SDK, scoped by the API's
accepted operation. The inference credential's discovered catalog must contain an
exact canonical `openai/gpt-image-2.5-flare` or `openai/gpt-image-2.5-sunburst`
mapping with `mode: image_generation`. Only those existing app controls are
supported; arbitrary image aliases/models are not guessed or substituted.
Public SDK settings carry fresh provider/header objects per call, with the same
verified Clerk UID customer injected last. The API uses native JSON
`/v1/images/generations` and multipart `/v1/images/edits`.
Authorized references and outputs use private temporary staging solely because the
public root API requires files; only immutable app file links survive.
Output URLs retain the existing app allowlist and refuse redirects; keys/customer
headers never accompany downloads. See [image ownership](chat-images.md).

Classification uses existing pi-classifier 0.4.1, packed unchanged with provenance.
The exact operator-selected model must be in the inference-key-permitted catalog.
The configured API is an explicit protocol contract, not inferred chat compatibility:
`openai-decisions` uses `/v1/decisions`; `system-one` uses `/v1/systemone`.
Only text/JSON bool, choice and score calls are declared to the isolated host.
No image/file access, computer control, tree, comparison, direct fallback or
automatic retry is installed. Missing/invalid settings or removed availability
refuse before paid invocation. The SDK uses explicit credentials, never Pi's store.
Operators must provision and verify the selected native decision model/protocol;
an ordinary chat model cannot emulate typed Decisions by URL configuration.

Protected Usage covers all attributed model traffic on the configured inference
key windows, including images/decisions, not just chat. Voice remains separate.
SDK-returned costs are not added to proxy totals; existing image receipts remain.
SDK prices can be Unknown even when the gateway reports spend. Default zero tokens
with actual attempts and no measured token activity remain Unknown, not fake usage.
Successful ordinary-text chat does not validate image/classifier inference,
reporting accuracy or telemetry delivery; those require separate live acceptance.

## Tracing ownership

Each process has one lazy private `@abhishek944/pi-langfuse` instance with explicit
metadata-only configuration; `PI_LANGFUSE_CAPTURE` cannot opt the app into full
capture. No payload, thinking, media, tool body or raw error is copied. Safe labels
include the unchanged verified Clerk UID, separate stage/owner/chat HMAC conversation
IDs and generated run IDs, never names/emails.
The host's explicitly declared factory is the sole reply/tool/compaction emitter.
The API's supported standalone generation adapter observes independent titles only.
Neither installs a global OTel provider. Events never await exports; exporter failure
is fail-open, and process shutdown owns disposal. There is no duplicate gateway trace
emitter or inference cost sum. Remote tool/provider internals remain unobserved.

The unpublished pinned package is consumed from the repository's packed artifact;
see [vendor provenance](../vendor/README.md). It is not a registry release, global
installation, absolute machine dependency or copied fork.

## Separate live acceptance

Each configured stage and model requires authorized live acceptance; source checks,
health and discovery are not substitutes for a completed, persisted app reply.
Ordinary-text chat acceptance does not establish image/classifier operation,
reporting or telemetry. Separately verify exact model/effort/endpoint,
customer/stage/key isolation, rotation coverage, prices/attempt counts, metadata-only
once-per-call grouping, disabled modes, Stop and exporter failure behavior.
Restart existing services only with their owner's coordination; do not kill retained
user services to pick up source changes. No publish, commit or deployment is implied.
