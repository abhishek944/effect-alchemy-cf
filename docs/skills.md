# Private chat Skills

## Product contract

Settings → Skills is one private library for the signed-in user, shared by all
of that user's chats. Upload one `.txt` or `.md` instruction file at a time.
The list shows full filenames and Download buttons. Files are downloaded for
external reading; there is no body preview, editor or detail page.

Uploading the same normalized filename requires an explicit Cancel/Replace
choice. Replace supplies the version the user confirmed; another tab's newer
version must not be overwritten silently. Original spelling and bytes are
preserved. Filename matching uses NFC normalization followed by lowercasing.

A lost upload response is not proof of failure. Keep the upload identity and
inspect its receipt before deciding what happened. A known publication remains
acknowledged if refreshing the list subsequently fails. Only an authoritative
list read updates displayed current files; an old receipt does not prove which
version is current. Checking a receipt must not replay an upload.

No ZIPs, supporting files, executable scripts or skill-image resources are
accepted. Markdown frontmatter is not required. These instruction-file limits do
not remove the chat's separate attachment or image features.

## Chat lifecycle contract

The model receives a short catalog and activates instructions on demand with
`skill(name)`. New, distinct Sends use a fresh verified library snapshot. Accepted
work and original-version retries keep their immutable original versions.

Retiring obsolete guidance on a subsequent Send does not delete visible history,
undo earlier actions, erase learned facts or promise semantic forgetting. Current
standing instructions must come from the current approved context, not replayed
raw skill-tool results or summaries.

An unavailable or unverifiable library blocks admission without losing input.
A genuine approved instruction-read failure after acceptance stops that answer
and preserves partial output as incomplete. It must not silently skip the file,
use a stale/empty library or continue by relying on a swallowed SDK hook error.

Before acceptance, the Skills unavailable notice keeps the draft and offers
Try again. This only rechecks readiness; it does not send or change the model.
The read has a 15-second deadline, and its button is disabled while checking.
After acceptance, the original-version recovery below is a different action.

Original Try again preserves the logical operation, original skill versions,
model/input, accepted attachment authority and account-action/Undo identity. It
uses one authenticated successor native attempt; replaying a settled native UUID
only repairs delivery and is not another execution.

An explicit New Send with current skills is different: current skills and an
explicit current allowed model selection, a new logical operation, a fresh active
instruction context and freshly prepared account intent. Its original caption and
files must remain independently verifiable even if old guidance is damaged.
Neither recovery action may overwrite an independent composer draft. Earlier
actions are not automatically rolled back; replayed receipts describe historical
actions rather than claiming a new mutation.

An uncertain New Send retains its exact UUID, source and frozen model/effort.
Only an exact acceptance or a tagged terminal rejection for that same new UUID
settles it; generic errors do not authorize a fresh replacement operation.
A terminal rejection requires durable proof that the UUID was not admitted and
must permanently prevent its later execution. Original Retry is never fenced
this way. Browser storage failure must not dispatch an unretained recovery.

## Implementation boundaries

- `apps/api/src/skills-model.ts` and `skills-manifest.ts`: schemas, filename keys,
  immutable references, scope-bound manifest digest and integrity verification.
- `skills-store.ts`, reservation/publication helpers and owner `ChatCatalog`:
  naming, immutable manifests, quotas and durable publication receipts.
- `skills-objects.ts`: private original-byte storage and complete digest/UTF-8
  verification. Keys derive from the real owner scope and version, not filenames.
- `chat-skills-*` and existing chat admission/runtime/projection seams:
  pinned attempts, bounded active context, SDK activation adaptation, mandatory
  model-request guards, cancellation, provenance and recovery.
- Web Skills components/hooks/client: minimal Settings surface and retained
  publication intent. Browser code must not import provider clients or secrets.

Reuse the installed Agents skills adapter/source/parser/activation rather than
introducing another YAML loader. Account/file authorization, model eligibility,
usage, Stop, history and title attribution remain application-owned boundaries.

## File HTTP interface

- `GET /api/skills[?uploadId=UUID]`: current verified list and optional receipt.
- `POST /api/skills?filename=...&uploadId=UUID[&replaceVersion=UUID]`: raw file
  bytes, not multipart; returns its publication acknowledgement.
- `GET /api/skills/download?id=UUID&version=UUID`: authenticated original
  attachment, never an inline application viewer.
- `POST /api/skills/cancel?uploadId=UUID`: explicitly fence an unresolved upload.
  An already-published upload returns its receipt unchanged; unpublished/unknown
  intent retirement returns expired. This is not a published-file Delete action.

Owner identity comes from authentication, never request/model scope arguments.
Mutations require the application origin. Responses are non-cacheable; download
also applies attachment, nosniff, sandbox and same-origin resource headers.

## Defensive storage bounds

- 64 KiB per file; valid nonempty UTF-8 text and bounded printable filenames.
- 32 current files; 512 live retained/reserved versions.
- 64 MiB retained/reserved original bytes.
- 4096 cumulative upload intents, including permanent expired tombstones.
  Existing idempotent receipts still work at this cap; new reservations stop.
- 256 permanent New Send rejection records per conversation. Existing records
  remain readable at the cap; inability to persist a new fence keeps uncertainty.
- 8 unresolved New Send commands per chat in browser storage; no silent eviction.
- 56 KiB for serialized active state and rendered active context, plus a separate
  selected-model request/output budget. SDK formatting adds overhead: an accepted
  upload can still be too large to activate. Nothing is silently shortened.

Publication rechecks its fresh candidate and head after asynchronous work, then
atomically promotes manifest/head/file/version/intent state. Abandoned unpublished
versions are claimed for retirement; published originals are never selected.

Original PUTs are create-only. Retirement replaces unpublished bytes with a
permanent zero-byte marker and retains the expired intent, preventing late PUTs
or UUID reuse from resurrecting an old intent. Original-byte quota is released
only after confirmed retirement. Active model context also has separate storage
and selected-model request budgets; it must not silently truncate instructions.

## Verification and rollout

Typechecks, lint, builds and source inspection do not prove runtime acceptance.
Before rollout, an explicitly approved isolated development procedure must verify
owner isolation, original-byte downloads, uncertain upload receipts, stale Replace,
keyboard/narrow/theme behavior, cold-start restoration, compaction, strict failure,
original Retry versus New Send, duplicate/uncertain acceptance, exact Stop and
account/file/usage authority. Retained partials and older failures must remain
truthfully attributable, with unavailable originals explicitly unrecoverable.

Do not infer provider/R2 behavior from a source fixture or local TypeScript pass.
Chat inference, titles and compaction can incur remote usage even on localhost.
No deployment, production resource use or billable acceptance flow is implied by
this document. Review existing development/stage instructions before any startup.
