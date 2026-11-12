# Chat models, reasoning and usage

## Gateway-owned chat availability

LiteLLM is the single available chat-model source. The API intersects the inference
credential's `/v1/models` with validated `/model/info` mappings, then enriches exact
canonical OpenAI/Anthropic models using pinned Pi 1.2.0 native metadata. Unsupported
or ambiguous aliases are not offered. No `CHAT_MODEL_ALLOWLIST` is read. The legacy
saved provider identifier `openrouter` remains a storage compatibility identifier,
not a direct-provider transport. Native Responses and Anthropic protocols point only
to the configured gateway. No direct-provider fallback is installed.

Gateway availability is not proof of live entitlement, pricing, every protocol field
or configured fallback behavior. Operators must verify exact canonical mappings,
matching native endpoints/efforts, no alternate-model fallback, no dropped parameters,
zero paid retries, usage logging and pricing before enabling inference. Configuration
and prerequisites are in [gateway setup](chat-gateway.md).

## Preferences and accepted work

The initial preference remains `openai/gpt-5.2` / High. Existing per-chat selections
and per-model effort memory are preserved. First use prefers High or explicitly
reports its supported lower adjustment. An unavailable saved model/effort needs an
explicit user correction, never implicit replacement. Revision-checked preference
writes do not overwrite newer choices from another tab.

Send freezes the selected model, effort and ordered file identities. Later changes
apply to the next Send, not accepted work. Replies, model follow-ups after tools,
compaction and independent titles all use LiteLLM with server-derived attribution.
API-owned image and classifier tools also use the gateway through their existing SDKs,
with separate capability gates and unchanged image receipts. Voice remains outside it.

One response runs per chat; another chat is independent. Busy sends are rejected,
not queued. An uncertain acceptance is repaired using its original UUID and exact
input, not replayed as paid work. Stop targets the exact accepted operation; an
acknowledgement is not a promise that an upstream provider stopped billing.

Missing/disabled inference configuration refuses new affected work before admission
or reservation, while saved chats remain readable. Report credentials are independent:
missing report access does not disable otherwise configured inference.

## Account-wide Usage

The protected `/usage` destination follows Home in the rail and has no chat sidebar
or right pane. It shows input/output tokens, actual reported requests and estimated
USD spend, grouped Daily, Models or Providers for the selected inclusive UTC dates.
Refresh reads reporting only; it never invokes a model. Account changes clear/fence
old requests. Date ranges are not subject to an application lifetime cap.

`GET /api/chat/usage?start=YYYY-MM-DD&end=YYYY-MM-DD` authenticates Clerk and forces
both that user's unchanged verified Clerk UID and one exact persisted stage inference-key identity
per upstream request. The reporting credential is never a customer filter. The public
schema includes source, model-usage scope, timezone, activation, period and completeness;
it never forwards administrative metadata, credentials, names or raw source IDs.

LiteLLM 1.108.4 `/customer/daily/activity/aggregated` is authoritative for attributed model usage.
It reports actual attempts, not just completed replies. A 400-day maximum date
difference is a vendor request constraint; longer windows are split into disjoint
inclusive intervals. Key rotation needs complete operator-supplied key windows.
Missing coverage produces Partial/Unavailable, never an unfiltered request or a
silent local-accounting fallback. Reporting begins at attributed activation, without
backfill, replay, deletion or import of earlier receipts. Older hashed-user records
are not automatically joined after switching to raw Clerk UID attribution.

Unknown counts/prices remain Unknown. Image/decision attempts with only default zero
tokens and no measured token activity do not prove zero token usage. Partial totals are not presented as complete
sums; failures/Stop are not automatically free. Estimated spend is not an invoice.
No optional cache/performance analytics or app-admin reporting console is added.
Operators retain their gateway reporting surface; global administrators may see both
stages despite application-level report filtering.

## Per-chat context and exact receipts

The existing Context/Cost tray and response facts retain their separate purpose.
Context estimates use the server's actual model context, not the browser's bounded
history window. Catalog list prices are estimates, not gateway account totals.
Reply, compaction, title, image and speech receipts remain separately attributable.
Never add gateway, Langfuse and local amounts together for the same model work.
Speech seconds/characters and nonchat costs are not fake context-token equivalents.

Static type/lint/build and fixture comparisons do not prove live gateway access,
customer accounting, authentication, billing, telemetry delivery or cancellation.
Live acceptance remains separately authorized and operator-owned.
