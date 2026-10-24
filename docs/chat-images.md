# Chat images and saved files

The app uses the published `@abhishek944/pi-image-gen@0.6.0` portable engine and
native Pi Durable extension. It does not copy provider serializers or run the
Node desktop extension in a Worker. Desktop package capabilities remain separate.

## Using images

- Set account-wide **Image model**, **Shape** and **Quality** in Settings → Images.
  Flare / Auto / Auto are the initial account defaults; Sunburst is also supported.
  These are independent of the chat text model. Setup state reflects nonsecret
  binding/route configuration only, not tested provider eligibility. Failed/conflicting saves preserve
  attempted choices and expose preference-only recovery.
- Use the existing Send action to ask clearly for generation or an edit. There is
  no Generate mode, composer settings popup, automatic Send or per-call approval.
  Supported explicit tool controls override omitted response defaults.
- Open **Files** in the existing right-pane toolbar. Search/filter/sort the saved
  collection independently of loaded messages. **+** opens an empty Tools tab;
  image tabs show the image above its details and private Download link.
- Type **@** to select exact saved files from this chat. Chips stay above the draft.
  Prepare edit/Add to draft selects the same immutable file; it never sends.
  A clear follow-up edit can reuse the exact recent image; ambiguous sources need
  clarification, not filename guessing. Edits create separate files with source links.
- Nonimages are download-only in the right pane. Safe text can still be referenced
  and quoted for chat reading. File contents and metadata are untrusted data.

Only explicit Send uploads staged local files. Saved references are not uploaded
again, rebound to another creator or removed when their draft chips are cleared.
Uncertain delivery retries preserve text, model, upload IDs, reference IDs and the
same operation UUID. Known accepted originals and later draft additions survive.

## Private storage and native history

The existing owner ChatCatalog and private stage-isolated ChatFiles R2 bucket own
metadata, quota and originals. Owner-catalog object scope is distinct from the
conversation object scope used by native proof; browser/model fields choose neither.
The 1 GiB retained/reserved quota remains enforced internally without a storage meter.

Every new ordinary or Skills recovery attempt freezes its image capability once
before native admission. A preference/configuration outage freezes image generation
as unavailable; it does not replace defaults later or disable ordinary text/Vision
lineage. A duplicate attempt reuses its original snapshot. Skills Retry preserves
logical ancestry and cannot regain already-used image-generation authority.

New native inputs and Skills rows contain caption and compact authenticated original
identifiers, not base64 or complete file bodies. Exact accepted input/submission,
entry/model slot, task/attempt/cutoff, owner and chat-model proof is required at the
final Models boundary. Only that request receives transient original bytes and
quoted text; hydrated values never enter checkpoints, memos, history or compaction.
Saved references resolve authorized immutable file IDs without recalculating or
comparing content checksums. Ownership, accepted state and bounded file-content
validation remain enforced; upload/ingest content identity is unchanged.
Hook exceptions alone cannot authorize fallback inference. Historical rows are not
rewritten or backfilled. Proven pre-image ordinary text-only continuations use a
fixed startup boundary and the same final native checks, without image-generation
authority; missing image-era sidecars and unprovable old binary recovery are refused.

Generation uses the actual configured Cloudflare catalog/Gateway route with one
provider attempt. The host reserves owner output storage before dispatch permission. Each immutable output is stored privately before a
compact link is returned. Receipts bind the real tool-calling assistant entry and
native call/output order, not whichever later prose reply is newest.

Archive preserves browsing/downloads but blocks new work. Already admitted storage
can finish; Stop does not erase accepted outputs or guarantee that billing stopped.
Closing a preview/viewer releases viewing resources, not durable work or originals.

## Execution limits and failure recovery

Existing uploads remain at 10 MiB / 16 MP per image, 1 MiB per safe-text file and
five files / 20 MiB per message, including references. These are not a promise that
every original fits a chat model or a 128 MiB Worker request.

There is no application-side image RAM estimate, shared reservation pool or
memory-admission gate. Generation and edits use the existing10MiB image-file
ceiling and a bounded encoded response body, with a120-second package deadline.
Actual model/context, file-size and storage-quota limits still apply. There is no
resizing, app queue, fan-out or new image-count cap. Cloudflare runtime memory
limits still apply: large requests can fail at runtime, including after charging.
No refund or free-failure promise is made.

Native generation allocates at most the lesser of advertised output,32,768 tokens
and half the model context, respecting a smaller explicit allowance. Earlier
Skills and final hydrated-input budgets reserve that same allocation; catalog
maximum output is not subtracted as though every response requested all of it.
The separate native compaction path is unchanged.

Cancellation still disposes owned response bodies. The image host waits for real
provider/body/storage work before finishing durable output intent; this is not
memory accounting or admission. Runtime heap behavior remains unverified. Arbitrary remote output
URLs are denied without established trusted origins; inline catalog outputs use the
shared package materializer. Original URL identifiers are never fetched externally.

A dispatched/uncertain failure never triggers automatic image regeneration.
Internal adapter, response-body and bookkeeping failures retain their original
native causes for fixed, correlated diagnostics; only allowlisted classification,
owner/operation and existing operation/call IDs are emitted. These reports never
replace a known accepted or partial output, add a retry, release an uncertain
claim or rewrite an uncertain write, and user/tool-facing messages stay unchanged.
Read-only Retry checks the same metadata/original/receipt; another paid attempt needs
a new explicit user request. Missing bytes keep file identity and an honest local
unavailable state. Partial successful outputs are retained. Interrupted unsafe native
calls reconcile existing receipts on reopen rather than repeating the paid request.

## Cost and routes

Existing Response facts and Cost details show image requests separately from native
text/voice accounting. Provider-reported cost wins over estimates. Gateway estimates
remain estimates; partial known components are not complete totals. Missing usage
stays Unknown, non-USD values are not converted, and request cost is never multiplied
by output count. The recent detail window is bounded; SQL lifetime totals are not.
No image cost is fabricated as native text-token Usage. Context facts include
proven active image presence. Unmeasured text originals without character-count
evidence make Context Unknown rather than counting only their compact links;
applicable real assistant usage still covers its measured prefix.

Authenticated, no-store read endpoints include:

- `/api/chats/:id/files` and `/api/chats/:id/files/:fileId`.
- `/api/chats/:id/attachments/:fileId` for private original GET/HEAD/download.
- `/api/chats/:id/messages/:messageId/files` for at most30 saved receipts per page.
- `/api/chats/:id/images/usage`, optionally filtered by exact native messageId.
- `/api/account/images/preferences` for versioned preference read/save.

Private generation reserve/consume/ingest/receipt routes are actor-only, not browser
endpoints. No provider key, R2 key, owner scope, canonical admission or binary payload
is exposed by the public saved-file/cost DTOs.

## Setup and acceptance

Use the existing stage-specific Gateway/AI binding and secure default BYOK aliases;
see [Pi chat](pi-chat.md). Local inference is remote and billable. Do not deploy,
provision keys, change production resources or call providers without approval.

Build/type/lint/source review cannot prove provider eligibility, charges, R2/SQLite
crash recovery, actual Proxy/stream behavior, aggregate heap or authenticated visuals.
After permitted live setup, verify two-user isolation; upload and @ retention across
reload/archive; readable saved originals and source links; preference CAS/outages;
runtime failures under load; Stop before/during provider/storage work; lost
consume/PUT/acceptance acknowledgments; retained partial outputs; no replay after
crash/reconnect/Skills Retry; exact assistant receipt/cost association; Unknown,
partial, zero and mixed-currency costs; and keyboard/IME/narrow/all-theme UI behavior.
No migration, backfill, deletion or unit-test harness is part of this feature.
