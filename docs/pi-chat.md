# Pi SDK chat

**Current runtime:** the API is a Node process and the Pi host is a separate Node process; neither is an edge Worker. See [runtime](runtime.md). The sections below that
describe the removed stack are historical and no longer describe how this repository
runs.

The signed-in dashboard uses its existing same-origin chat API. A Cloudflare
conversation Durable Object owns private accepted-operation identity, finalized
transcript, files and accounting. **Only `apps/chat-host` executes the real
`@earendil-works/pi-coding-agent` SDK in Node.** There is no Worker agent runtime,
legacy fallback, shell, filesystem workspace or browser-side provider client.

The default remains **GPT-6 Luna / High**. Model/effort selection, streamed text,
Stop, paged history, profile/theme tools, private uploads/references, image
creation/edits, Skills and usage remain application features. See
[models/usage](chat-models-usage.md), [files](chat-files.md),
[images](chat-images.md), [Skills](skills.md), [titles](chat-titles.md) and
[voice](chat-voice.md). Queueing, Fast and PDF remain absent.

## Runtime and authority

```text
browser → authenticated same-origin Worker API → private conversation object
                                                  ↕ authenticated run channel
                                              Node Pi SDK host
```

The object validates the selected stage model and freezes one accepted operation
before starting work. A new Send in a busy chat is rejected, not queued. Another
chat runs independently. Retrying the same operation UUID repairs its acceptance;
changing its text, selection or ordered file/reference identities is rejected.

The Node host creates one in-memory `AgentSession` per run and restores finalized
history through `SessionManager`. Real direct extensions register the declared
account, image and `skill` tools with `pi.registerTool`. Builtin tools, discovered
extensions/skills/prompts/context files, MCP, automatic retries, cache warming
and image resizing are disabled. SDK compaction can run within a response; its
provider calls are accounted separately. Its temporary compacted context is not
checkpointed between responses, so later responses may compact again.

The host has no provider credential. Its model provider transports normalized
requests back to the object, which hydrates authenticated originals and calls the
existing development/production Workers AI Gateway binding. Tool callbacks must
match the active accepted operation and its exact stored assistant tool call.
Model arguments never choose an owner, catalog or private storage scope.

New transcript inputs contain compact metadata, not original base64 or full file
bodies. Historical and current originals are loaded only at the final provider
boundary. Office documents remain metadata-only. Profile reads are non-creating;
theme changes still require the user's own frozen command and catalog receipts.
Usage records each attempted provider request and upgrades its Unknown claim with
actual reported usage, including compaction, title and speech attribution.

## Persistence and cancellation

Finalized transcript and accepted-operation receipts remain in object SQLite.
On first open, old transcript rows are imported with their existing entry IDs;
old accepted UUIDs, including unplaced inputs, remain terminal deduplication
records. Old tasks/checkpoints are never resumed or executed. Old storage is not
deleted. There is no permanent chat-erasure promise.

**Process-loss recovery is intentionally removed.** Losing the host or object
run channel makes the run unanswered, preserves already finalized/partial output
and accepted files, and does not retry paid work. A fresh object marks an
interrupted operation unanswered. A new message is a new explicit operation.
Original-version Skills checkpoint recovery is no longer offered.

Browser SSE disconnection, chat switching and archiving affect visibility only;
they do not close the object-owned host channel. **Stop** withdraws the exact
operation's local tool/provider authority and targets only that host run. A stale
Stop is a settled no-op and cannot cancel a later response. Its acknowledgement
is not a promise that an already dispatched provider stopped billing. Accepted
image outputs are not erased. Busy state clears when the run actually settles.

## Authentication and reading

Every public list/read/send/Stop/update/events action still resolves Better Auth
identity and owner authorization. Cross-origin mutations are rejected. Cloud dev
uses Cloudflare Access before application authentication; local users/storage
remain separate. Host tokens never enter responses or browser bundles.

Snapshots keep the existing window of 80 committed messages plus a live preview,
512 UTF-16-unit prefixes, history cursors and 32 KiB text pages. Existing browser
400-identity/2 MiB reading budgets and complete-text copy requirements remain.
Missing text and revision conflicts are explicit, not silent truncation. Streams
still reconnect to revalidate authentication. Archive retains history/files and
blocks new sends; rename, unarchive and automatic titles remain supported.

## Local development

Use Node >=22.21.1 and the repository's single pnpm workspace/lockfile.
`pnpm dev` starts the Node host at `127.0.0.1:1338`, generates an ephemeral
service token in memory, then starts the local Worker at `localhost:1337`.
Closing the launcher stops both. An occupied host port fails startup rather than
silently selecting another service. Vite remains `pnpm dev:web`, with the main UI
at port 5173 and the admin UI at port 5175.

`packages/config/.env.local` supplies the explicit development Gateway and exact
JSON `CHAT_MODEL_ALLOWLIST`. The launcher overrides inherited host settings with
its own loopback host/token and never reads `.env.prod`. Missing Gateway/BYOK or
allowlist configuration disables sending. Inference, titles and compaction are
remote and billable even on localhost. No provider is contacted by construction,
typechecks, lint or builds.

The pinned SDK and its Earendil dependencies are kept at 1.1.0. Root pnpm overrides
prevent incompatible newer caret-range exports from entering that SDK graph.

## Cloud hosting: code wiring, not a deployment

The Alchemy Worker is not a supported Node host. Provision a separate Node
service for `pnpm --filter @highchat/chat-host start`, with private
`CHAT_HOST_TOKEN` and a valid `CHAT_HOST_PORT`. The included server binds loopback;
put a same-host TLS reverse proxy in front of it. Do not expose its port directly.
All endpoints, including health, require the bearer token.

Set the nonsecret `CHAT_HOST_URL` HTTPS origin in the stage's gitignored env file.
Supply the same private `CHAT_HOST_TOKEN` to the approved stage deployment
secret environment and Node service; Worker options bind it as a redacted value.
Do not store it in source, stage files, command logs, browser variables or chat.
Provider credentials continue to belong in Cloudflare profiles/BYOK, not Node.
Development and production must use separate host origins/tokens, Gateways,
allowlists, databases, buckets and signing secrets. The env checker rejects a
shared dev/prod host origin. Blank configuration fails closed, never falls back.

This repository wires the Worker host URL/secret and supplies runnable Node code;
it does **not** provision a Node machine, TLS endpoint or credentials. Selecting
and provisioning those stage resources, granting secret authority, reviewing the
Alchemy plan and approving deployment are operator actions. Local static checks
do not establish endpoint reachability, Access/HTTPS, real provider eligibility,
R2 behavior, paid accounting, process-loss timing or deployed acceptance.

## User-owned acceptance after explicit setup

1. Verify unsigned and cross-owner requests reveal no chat/file data.
2. Send in two chats, switch/reload, and confirm private streamed/final history.
3. Retry one UUID with the same input; confirm no duplicate run. Changed input
   under that UUID must fail, including after old admission leases expire.
4. Stop during streaming and tool work; repeat and deliver an old Stop after a
   newer response begins. Only the original operation may be affected.
5. Upload/reference image and text originals, select exact text slices, and edit
   an exact saved image. Confirm private files/receipts survive reload/archive.
6. Activate a Skill, replace its library version, then Send again. Only the new
   Send sees current guidance; an active run retains its prepared snapshot.
7. Verify theme authorization, profile reads, tools and title/speech/image/model
   usage. A provider failure must be an error, never a fabricated success.
8. Close a browser tab without stopping work. Separately restart the host during
   a response: expect unanswered/no automatic replay, with retained finalized data.

Run `pnpm lint` and `pnpm build` before handoff. Unit tests and live interactive
end-to-end/provider calls are not part of this migration's static verification.
