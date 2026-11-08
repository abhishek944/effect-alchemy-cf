# Chat images and saved files

**Current runtime:** paid image generation has no configured transport in this runtime and reports itself as not configured. See [runtime](runtime.md). The sections below that
describe the removed stack are historical and no longer describe how this repository
runs.

The app uses the published `@abhishek944/pi-image-gen@0.6.0` portable engine.
A direct Pi SDK extension in the Node host registers `image_generate`; its
operation-scoped Worker callback owns authorization, the existing Cloudflare
binding, immutable output storage and accounting. No legacy agent runtime or
Node desktop image extension executes in the Worker.

## Using images

- Settings → Images retains account-wide Image model, Shape and Quality.
  Flare / Auto / Auto are the initial defaults; Sunburst is also supported.
  Setup state proves configuration presence, not provider entitlement. Failed
  preference writes preserve attempted choices and expose conflict recovery.
- Use the existing explicit Send to request generation/editing. There is no
  Generate mode, automatic Send or per-call approval. Tool controls override
  omitted response-frozen defaults.
- Files in the right pane contains saved uploads and generated images separately
  from loaded transcript pages. Image tabs show the original and private Download.
- Use @ or Add reference to select immutable same-chat files. Preparing an edit
  never sends. Edits create separate files with source links; clearing a chip
  neither deletes an original nor changes an already accepted input.
- Nonimages remain download-only or safe text previews. Office documents are
  metadata-only; their content is not decoded or sent to the model. Metadata,
  quoted text and file bodies remain untrusted data, never authority/instructions.

Uncertain message delivery keeps the same caption, model, upload/reference IDs
and operation UUID. Known accepted originals and later independent drafts survive.
See [private files](chat-files.md) for upload/format/selection details.

## Ownership, context and storage

The owner ChatCatalog and stage-isolated private ChatFiles R2 bucket retain
metadata and originals. Their owner scope comes from the authenticated catalog
actor, never model arguments. There is no retained/reserved owner byte quota.

Before accepting a new operation, the object verifies uploads and exact saved
references, freezes compact original identifiers/reference slices and snapshots
image preferences/configuration once. Preference/configuration failure freezes
image generation unavailable; it does not silently change defaults later.

New transcript rows contain compact caption/reference metadata, not base64 or
full original bodies. At each actual model request, server transcript entries
map historical/current user messages to their immutable accepted sidecars. The
callback rechecks owner, chat, accepted state, metadata, format and model
compatibility before reading exact private originals. Text is quoted as untrusted
content; selected original text uses only its frozen slices. Images are transient
original blocks. Missing/altered sidecars fail closed, never authorize fetching a
URL guessed from model text. Historical valid inline images remain readable.
No resizing, silent dropping or truncation is used to make an original fit.

The object verifies each `image_generate` callback against the active operation
and the exact stored assistant tool call. Edits resolve only authorized same-chat
immutable attachment URLs. Arbitrary remote URLs, local paths, credentials and
model-provided owner/storage scope are refused. Generation uses one actual
configured catalog/Gateway route; the portable engine owns provider serialization.

One dispatch claim precedes contact. Each accepted output is written privately
before compact file links are returned. Existing call receipts bind the assistant
entry, native call position and output order; file reads and image usage endpoints
retain their public contract. Accounting records real dispatch/result evidence;
Unknown or partial outcomes are not reported as free or successful.

## Stop and process loss

Stop revokes the exact run's further callback authority, cancels owned response
work where supported and asks the Node SDK session to abort. It cannot promise
that already dispatched provider work stopped billing. Accepted outputs and
originals are not erased. Archive preserves browsing/downloads and blocks new
work; a previously admitted output can finish its storage obligations.

A dispatched/uncertain failure never automatically regenerates. The same call
cannot be replayed into another paid attempt. Process-loss checkpoint recovery
has been removed: losing the object/host channel makes the response unanswered,
retains existing receipts/files and requires a new explicit user request for new
paid work. Read-only file retry can inspect the same original/receipt; it is not
a generation retry. Browser preview/SSE cleanup does not stop a model run.

## Capacity boundaries

No new app file-byte/pixel, attachment-count, message-byte, caption, quoted-text,
browser staging/preview or output-storage cap is added. Actual browser/Node/Worker
heap, CPU, provider context and SQLite row/string/BLOB limits still apply.
Whole-original validation/hydration can fail at the Worker's 128 MiB memory limit.
There is no app RAM estimator, reservation pool or extra memory-admission gate.

Existing installed image-engine limits are preserved: 20 MiB per image, 128 MiB
aggregate references, 16 references, a catalog envelope of base64(20 MiB) plus
1 MiB, and its 120-second generation lifetime. The existing tool schema also
retains its 32,000-character prompt and 8,192-character source-URL validation.
These are inherited engine/tool boundaries, not an unlimited-capacity claim.

Text model output is fitted to the actual selected model's remaining context
and output capacity after complete hydration, preserving any smaller explicit
SDK allowance. The installed token estimate is not the provider tokenizer;
provider context failures and post-charge runtime failures remain possible.
No app 32,768-token ceiling, half-context reserve or guessed bytes/token budget
is introduced. No refund/free-failure promise is made.

## Setup and acceptance

Use the Node host and Gateway setup in [Pi chat](pi-chat.md). Provider credentials
remain in Cloudflare profiles/BYOK, not browser code, Node host configuration or
stage files. The private Node service token authorizes transport only.

After explicit setup, verify two-owner isolation; upload/reference/edit flows;
current and historical image/text hydration; selected slices; office metadata;
Stop during provider/body/storage phases; duplicate/uncertain calls; immutable
file links/receipts; image/model/title/speech usage; reload/archive browsing; and
read-only recovery without regeneration. Typechecks/lint/builds and SDK
construction do not establish real provider, R2, paid or deployed acceptance.
No unit tests or live interactive end-to-end/provider calls are implied.
