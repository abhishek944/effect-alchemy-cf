# Chat images and saved files

The API wires the existing `@abhishek944/pi-image-gen@0.6.0` public SDK through
LiteLLM. This is source wiring, not configured models or successful live generation.
Without valid server settings and supported discovered mappings, image work refuses
before reservation. See [gateway prerequisites](chat-gateway.md).

## Using images

- Settings → Images retains account-wide Image model, Shape and Quality.
  Flare / Auto / Auto are the initial defaults; Sunburst is also supported.
  Configuration presence does not prove provider entitlement. Failed preference
  writes preserve attempted choices and expose conflict recovery.
- Use explicit Send to request generation/editing. There is no automatic Send or
  per-call approval. Tool controls override omitted response-frozen defaults.
- Files in the right pane contains saved uploads and generated images separately
  from loaded transcript pages. Image tabs show the original and private Download.
- Use @ or Add reference to select immutable same-chat files. Preparing an edit
  never sends. Edits create separate files with source links; clearing a chip
  neither deletes an original nor changes an already accepted input.
- Nonimages remain download-only or safe text previews. Office documents are
  metadata-only; their content is not decoded or sent to the model. File bodies,
  names, metadata and quoted text remain untrusted data, never authority.

Uncertain message delivery keeps the same caption, model, upload/reference IDs
and operation UUID. Accepted originals and later independent drafts survive.
See [private files](chat-files.md) for format, selection and upload details.

## Ownership and exact dispatch

The authenticated owner catalog and local private object store retain metadata and
originals. Scope comes from the verified immutable owner binding, never tool input.
There is no retained/reserved owner byte quota.

Before accepting a new operation, the conversation verifies uploads and exact saved
references, freezes original identities/slices and snapshots image preferences plus
a nonsecret gateway configuration fingerprint. Missing preferences or unavailable
selected model freezes image work unavailable, without silently changing defaults.

Transcript rows retain compact reference metadata, not base64 or scratch paths.
At model request time, immutable accepted sidecars map current/historical user
messages to their originals. Hydration rechecks owner, chat, accepted state, format
and model compatibility before exact private reads. Text uses only accepted slices.
Missing/altered sidecars fail closed. Existing valid inline history stays readable.
There is no silent image resizing, dropping or truncation to make inputs fit.

Every `image_generate` callback matches the accepted operation and exact stored
assistant tool call. Edits resolve only authorized same-chat immutable originals;
arbitrary remote URLs, local paths, credentials and model-owned scope are refused.
Gateway discovery intersects the inference key's permitted models with exact
`image_generation` mappings for the two existing canonical image identities. No
manual availability list, alternate model, direct fallback or retry is installed.

The API supplies fresh per-call SDK settings, endpoint, key and unchanged verified
Clerk UID customer, shared consistently with classification and chat attribution.
The host receives only declared controls and compact results, never those settings.
The public SDK owns JSON generation and multipart edit serialization. Authorized
reference bytes are temporarily staged in a private platform-owned directory because
its root API requires files. Real outputs are read back, validated by the portable
engine and stored immutably through the existing app sink; scratch files are removed
and no scratch path enters receipts, transcript or public results.

Provider output URLs retain the existing HTTPS Gateway-output host policy and now
refuse redirects. Downloads carry no inference key or customer header. MIME/image
validation and inherited byte boundaries remain in force. One durable dispatch claim
precedes the actual authenticated HTTP call; missing configuration refuses earlier.

Each accepted output is written privately before compact links are returned. Existing
receipts bind assistant entry, call position and output order; legacy catalog receipts
remain readable alongside new provider-route receipts. Real SDK body usage/reported
cost is retained where its public contract exposes it. Missing cost stays Unknown;
proxy response-cost headers are not relabelled provider charges. Never add local
receipts to the same work's authoritative gateway Usage totals.

## Stop and process loss

Stop revokes the exact run's further callback authority and propagates cancellation.
Actual provider/body/storage work is tracked and drained before finalization and
scratch cleanup. Cancellation cannot promise dispatched work stopped billing.
Accepted outputs/originals are not erased. Archive preserves browsing/downloads and
blocks new work; admitted output storage can still finish its existing obligations.

Dispatched/uncertain failures never regenerate automatically. The same call cannot
be replayed into another paid attempt. Process loss retains existing files/receipts
and requires a new explicit request for new paid work; no paid backfill or recovery
replay is added. Read-only retries inspect the same original/receipt. Browser preview
or SSE cleanup does not stop a model run.

## Capacity and verification

No optional app file/pixel, attachment, caption, quote or output-storage cap is added.
Actual Node/browser memory, provider context and SQLite/runtime constraints apply.
Inherited engine limits remain: 20 MiB per image, 128 MiB aggregate references,
16 references, the existing base64(20 MiB) plus 1 MiB response envelope, and a
120-second generation lifetime. Existing tool limits remain 32,000 prompt characters
and 8,192 source-URL characters. These are inherited, not an unlimited-capacity claim.

Text-model output still fits actual remaining context/output capacity after full
hydration, preserving a smaller explicit SDK allowance. The token estimate is not
the provider tokenizer; context and post-charge failures remain possible.

User-owned live acceptance after separate authorization: exact model and customer,
two-owner isolation, edits and historical references, MIME/URL refusals, Stop during
HTTP/body/storage, uncertain/duplicate calls, retained links/receipts, archive/reload,
unknown costs and shared gateway reporting. Lint/build/schema checks do not prove
model entitlement, paid protocol behavior, customer rows or cancellation timing.
No unit tests, real image calls, telemetry exports or live E2E are implied.
