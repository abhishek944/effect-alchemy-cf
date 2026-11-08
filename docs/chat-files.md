# Private chat files

**Current runtime:** files are stored by the local `ObjectStore` under `var/storage/objects`; there is no bucket binding. See [runtime](runtime.md). The sections below that
describe the removed stack are historical and no longer describe how this repository
runs.

Chat accepts JPEG, PNG, WebP and allowlisted safe UTF-8 text/Markdown/CSV/JSON/code
files, plus modern XLSX, DOCX and PPTX document originals. Documents are format-only
attachments: the picker, drop and paste paths require a real OOXML ZIP container with
`[Content_Types].xml` and the matching family entry, and never unzip or render it.
PDF, legacy XLS/DOC/PPT, generic archives, SVG, audio and video are not attachments.
The picker, drop and paste paths share validation; ordinary pasted text remains
editable draft text. Nothing executes uploaded markup or code.

## Send and storage

Files stay local until explicit Send. Uploads use authenticated same-origin
`/api/chats/:chatId/attachments/:fileId` routes, then the single direct message
submission freezes their UUIDs with the selected model/effort. Keep the same
operation and file IDs when acceptance is uncertain; never re-send a changed
selection under an old UUID. Preparation/upload failures preserve the draft and
local originals for send recovery or removal. Composer cards show a local content
preview, filename, individual size and Remove, with a neutral border in all five
themes. Click the thumbnail to preview; there is no separate Preview button.
Previewing never uploads a file.
Failed files keep their explanation; remove and reattach files that cannot prepare.
Frozen sends keep Remove disabled until their outcome settles.

An accepted message retains private originals across reload/archive. Metadata and
accounting live in the owner's catalog actor; bytes live in the stage's private R2
`ChatFiles` bucket. Object keys include the real owner actor's identity, not just
browser-supplied chat/file IDs. No public domain, public URL, CORS, provider key,
base64 payload or owner identifier is exposed in the public descriptor/history.

Visible Files, sent-file and reference thumbnails show content when available.
Loading, unavailable, empty or complex thumbnails show a quiet file icon, not prose.
Images retain exact right-panel tabs. Cards show escaped text excerpts and
quoted-field-aware CSV tables; text tabs use the decoded original for exact
selection. Click a non-image card for a larger read-only preview; non-TXT text
source links and Open in panel use a text preview tab. XLSX, DOCX and PPTX cards show
file metadata and a download link only: their content is not decoded, previewed,
converted or sent to the model. Text originals download as plain text; document
originals download unchanged with their declared OOXML media type. Downloads use
attachment, `nosniff`, no-store and sandbox policy; images retain their validated
inline format. At the proven model request boundary, every allowlisted text
original, CSV included, becomes quoted untrusted text, and images become transient
native image blocks. Every document attachment is described only by untrusted name,
media type and byte-size metadata, so both the model and the interface report that
document content is unavailable.
Sent bubbles show the exact caption first, immutable selected-area rows, then two-column
attachment previews with existing file actions. Background opened-file context stays hidden.
Selected text expands below its source; original-file offsets without stored quotation
bytes show an unavailable note, never current file text. No complete file body is stored
in new model inputs. Attaching or uploading alone never sends content.

Uncommitted uploads expire after 24h, with scheduled bounded cleanup. An upload
bound to uncertain native acceptance is retained until acceptance can be
reconciled; an unavailable/unconfirmed receipt never authorizes erasure of a
possibly accepted original. Accepted originals are not deletable through Remove;
there is no permanent-erasure promise.

## Capacity boundaries

The app imposes no original-file byte/pixel ceiling, attachment-count limit,
whole-message attachment quota, quoted-text cap, owner storage quota or browser
staging/preview admission budget. Workspace tabs and accumulated file lists have
no app count ceiling; list endpoints still use explicit pagination.

This is not unlimited capacity. Upload/content validation and request hydration
still materialize whole originals, so real browser and Worker memory/CPU limits
can fail an operation. Uploads use one native request buffer, not a retained chunk
list plus another concatenation. Exact length, content and upload hash checks stay.
Model dimensions, encoded image bytes, modalities and context still apply; the
installed generation SDK has its own non-overridable limits. No silent resizing,
truncation or dropping historical images is permitted.

### Compact native inputs and platform storage

Cloudflare's SQLite row limit is not used as a new-image byte allowance. New
inputs freeze compact caption/reference metadata and hydrate exact private
originals only for the proven provider request. No conservative128KiB compact or
1.75MiB legacy allowance remains. Actual SQLite string/BLOB/row constraints can
still reject storage; no capacity claim or extra envelope reserve replaces them.
Historical inline rows remain unchanged and readable.

There is no app-side RAM estimate or reservation gate. Cloudflare may still
fail a request at its real128MiB runtime memory limit. Model image/context and
SDK/platform limits remain; there is no silent resizing or promise that an
original fits every request. See
[chat images and saved references](chat-images.md) for honest post-charge failures,
per-chat library/@ behavior and accounting.

Models may also impose smaller image dimensions or encoded-byte limits. Existing
images in the authoritative model context must be compatible with the next
selected model. Choose another model or a new chat when they are not; changing
models never rewrites accepted history.

Source: [Cloudflare Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

## Saved references

Image and file attachment actions use **Add reference** with an **@** icon; this
only prepares the next message and never sends it.
Files contains accepted uploads and generated images, independent of loaded
transcript pages. Card footers show only the name, time, size and download icon;
media types, dimensions and origin labels are not displayed there. Select exact same-chat files with @; saved references are frozen
separately from new uploads, never rebound or deleted when removed from a draft.
Uploads and saved references share identity and model validation. Archive keeps read access,
and missing originals keep identity with read-only Retry. Generated edits are
separate immutable files with source links; no persistent storage meter is shown.

## Inline references and selections

`+` and external files are new uploads. `@`, Add reference and eligible loaded
file tab drops insert atomic inline references, not uploads. Plain text
paste cannot forge reference identity. Undo restores token identity through the
editor library; assistant-ui remains the text/voice runtime and Send owner.
Tools, Files-library and New tabs are not individual sources.

The upper tray retains the latest completed selection per source until Close,
including after Send. Close excludes that source’s automatic selected range from future
Sends until a new completed selection is observed. It never removes an explicitly inserted
inline token or original, and never changes an already frozen Send/retry.
Click View to reveal that exact source/scope; changed or unavailable captures
refuse rather than selecting newer content. Right-click or the keyboard menu
explicitly adds a reference at the remembered composer caret. Observation alone
never adds message context. Text previews map displayed offsets back to raw UTF-16
originals.

Send freezes the caption, UTF-16 occurrence spans and original selectors before
asynchronous work. Retry retains that tuple. Selected original text hydrates only
its declared slices. Inline occurrences have no app count cap; repeated originals
resolve once by identity. Historical accepted inputs and absent/empty reference
identities stay unchanged.

Refresh restores account/chat-scoped tab and pane descriptors through fresh reads,
not editor grants, private content or tray selections. Unresolved original tabs
remain read-only: refresh never replays a write. Explicit
opens and restores stay bound to their origin chat across visibility changes.
Settings, pane visibility and switching chats retain mounted native editors;
close, sign-out and account teardown retain their unsaved-data protection.

## Setup and acceptance

Infrastructure declares one private stage-isolated bucket with public access,
custom domains and destructive force deletion disabled. This is source wiring,
not permission to provision/deploy. Review a plan and obtain approval before
applying cloud changes. Development must never reference production storage.

After explicit setup, verify owner isolation using two users, reload/archive
retention, picker/paste/drop, mandatory SDK/platform boundaries, invalid UTF-8/format/dimensions,
concurrent upload claims, duplicate UUID/content rejection, uncertain send
repair, preview resource cleanup and24h abandoned cleanup. Lose the retain
acknowledgment after native acceptance and confirm the same operation/probe
preserves the original. Builds/static checks do not prove R2 or deployed recovery.
