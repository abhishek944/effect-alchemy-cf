# Pi SDK chat

The local Node API owns authenticated operations, transcripts, files, accounting and
provider HTTP. A separate private Node host owns the real Pi SDK AgentSession and
tool loop. There is no edge runtime, infrastructure-as-code provider or deployment
configuration. See [runtime](runtime.md), [gateway setup](chat-gateway.md),
[models/usage](chat-models-usage.md), [files](chat-files.md), [images](chat-images.md),
[Skills](skills.md), [titles](chat-titles.md) and [voice](chat-voice.md).

```text
browser → authenticated same-origin Node API → private conversation object
                                                  ↕ authenticated run channel
                                              private Node Pi SDK host
                                                  ↕ normalized model requests
                                              API → LiteLLM → model
```

## Runtime and authority

The API validates the permitted gateway model and freezes one accepted operation
before work starts. A new Send in a busy chat is rejected, not queued. Another chat
runs independently. Retrying the same operation UUID repairs exact acceptance;
changing its input/selection/ordered references is rejected. There is no paid replay.

The host creates one in-memory AgentSession per run and restores finalized history
through SessionManager. Explicit factories declare account/image/Skill tools and
metadata-only Langfuse observation. Builtin tools, discovered extensions, skills,
prompts, context files, global credentials, MCP, retries, cache warming and resizing
remain off. Provider credentials stay in the API, never host run requests/browser.

The host transports normalized model requests to the API, which hydrates authorized
originals and calls LiteLLM through pinned native protocol serializers. Exact saved
model/effort is retained for replies, tool follow-ups, compaction and titles. Removed
or incompatible choices become unavailable rather than silently replaced. Gateway
configuration cannot enable image/classifier or voice inference through this path.

New transcript inputs contain compact metadata, not original base64/file bodies.
Originals are hydrated only at the final authorized provider boundary. Office
content remains metadata-only. Tool callbacks must match the accepted operation and
its exact stored assistant tool call; model arguments never choose an owner or
storage scope. Earlier Skill guidance retires before the next Send.

## Identity, privacy and observation

Clerk backend verification supplies canonical ownership. Its unchanged UID is the
LiteLLM customer, OpenAI `user`, own-user report filter and Langfuse user label, as
explicitly authorized. Only the separate stage/owner/chat conversation ID remains
HMAC-derived; different chats never share the UID as their conversation ID.
The API overwrites customer headers on every actual model dispatch; browser/model
parameters cannot nominate another user, endpoint, stage or key. Accepted work keeps
its owner despite browser account changes.

Every app-owned Pi session uses one explicit metadata-only host tracing factory;
independent title model calls use a separate supported generation adapter. The host
is the sole reply/compaction/tool emitter, not a second API provider callback.
One lazy private exporter belongs to each process, events do not wait for delivery,
shutdown owns disposal, and failures are fail-open. No prompts, replies, thinking,
tool bodies, media, raw errors, names or emails are copied into telemetry. The raw
verified Clerk UID is the explicit user-label exception, not a payload-capture mode.
Older hashed-user records are not automatically joined; no local migration is needed.
Tool wrapper spans do not observe hidden remote provider HTTP work or costs.

## Persistence and cancellation

Finalized transcripts, exact accepted-operation receipts and files remain in local
SQLite/object storage. Historical entry identities and terminal deduplication records
are retained; no history import into LiteLLM, wipe or replay is added. Process loss
ends the run unanswered and does not resume paid work. Finalized/partial evidence
survives; a new message is a new explicit operation.

Browser SSE disconnection, chat switching and archiving affect visibility only.
Stop withdraws the exact operation's tool/provider authority and targets that host
run. A stale Stop cannot cancel a later reply. Its acknowledgement is not a guarantee
that an already dispatched provider stopped charging. Accepted outputs survive.

SDK compaction runs within a response and its usage remains separate. Its temporary
compacted context is not checkpointed between responses, so later sends may compact
again. Local exact receipts/context estimates remain separate from the authoritative
account-wide chat-model report at `/usage`; nonchat records are not deleted or added
to gateway totals. Report/tracing credentials fail independently of inference.

## Authentication and reading

Every public list/read/send/Stop/update/events request verifies Clerk identity and
owner authorization. Cross-origin mutations are rejected. Private host tokens never
enter public responses or browser bundles. Existing bounded snapshot/history/text
paging and browser reading budgets remain unchanged; missing text/revision conflicts
are explicit. Streams reconnect to revalidate authentication. Archive keeps history
and files while blocking new sends; rename/unarchive/title behavior remains.

## Local setup and source checks

Use Node >=22.21.1 and the pnpm workspace/lockfile. `pnpm dev` runs through Doppler
project `effect-boilerplate`, config `dev`; it starts the private host at loopback
1338 with an ephemeral token and the API at 1337. Vite main/admin stay at 5173/5175.
The launcher preserves injected credentials and does not load profile/env files.
No production configuration is loaded by the dev launcher. An occupied host port
fails startup instead of silently choosing another service.

Pi API/host dependencies are aligned at 1.2.0 to satisfy the classifier SDK peer.
Langfuse and classifier use reproducible local packed artifacts with provenance,
not registry publications or absolute developer paths.
Operators separately supply gateway keys/models, complete stage key-report coverage,
stable identity material and distinct Langfuse projects through Doppler. Missing
inference settings keep saved chats usable but refuse affected work before admission.
See [gateway names/prerequisites](chat-gateway.md); no services are provisioned here.

Run `pnpm lint` and `pnpm build` before source handoff. Unit tests, paid inference,
telemetry exports and live browser end-to-end are not part of static verification.
Existing retained services need an owner-coordinated restart to consume changes;
never stop them blindly for checks. No commit, publish or deployment is implied.

## User-owned acceptance after separate authorization

Verify unsigned/cross-owner rejection, exact model/effort and attempt attribution,
own-user/stage/key reporting, multiple chats, revision conflicts, same-UUID repair,
Stop/stale Stop, reconnect, archive/rename, retained originals and Skill snapshots.
Check metadata-only once-per-call grouping, title/compaction observation, disabled
inference, missing report access and exporter failure without paid-chat failure.
Inspect reported attempts/pricing and real gateway billing independently. Static
checks/fixtures do not prove live authentication, model entitlement, delivery,
telemetry export, cancellation timing or account isolation.
