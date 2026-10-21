# Private chat files

Chat accepts JPEG, PNG, WebP and allowlisted safe UTF-8 text/Markdown/CSV/JSON/code
files, plus modern XLSX, DOCX and PPTX originals in the Office source implementation.
PDF, legacy XLS/DOC/PPT, generic archives, SVG, audio and video are not attachments.
See [Office setup and boundaries](office.md): the new Office build/runtime is not yet accepted.
The picker, drop and paste paths share validation; ordinary pasted text remains
editable draft text. Nothing executes uploaded markup or code.

## Send and storage

Files stay local until explicit Send. Uploads use authenticated same-origin
`/api/chats/:chatId/attachments/:fileId` routes, then the single direct message
submission freezes their UUIDs with the selected model/effort. Keep the same
operation and file IDs when acceptance is uncertain; never re-send a changed
selection under an old UUID. Preparation/upload failures preserve the draft and
local originals for explicit Retry/Remove.

An accepted message retains private originals across reload/archive. Metadata and
quota live in the owner's catalog actor; bytes live in the stage's private R2
`ChatFiles` bucket. Object keys include the real owner actor's identity, not just
browser-supplied chat/file IDs. No public domain, public URL, CORS, provider key,
base64 payload or owner identifier is exposed in the public descriptor/history.

Previews are on demand in the right-pane Files library and exact image tabs.
Text originals download as plain text; Office originals retain their declared
binary media type and filename. Downloads use attachment, `nosniff`, no-store and
sandbox policy; images retain their validated inline format. At the proven model-request boundary, the model receives quoted untrusted
text or transient native image blocks; visible bubbles keep the caption and
compact file rows. Office bytes are neither UTF-8 excerpts nor base64 model blocks:
finite Office tools read proven accepted originals. No complete file body is stored
in new native inputs. Attaching an Office file never creates a document automatically.

Uncommitted uploads expire after24h, with scheduled bounded cleanup. An upload
bound to uncertain native acceptance is retained until acceptance can be
reconciled; an unavailable/unconfirmed receipt never authorizes erasure of a
possibly accepted original. Accepted originals are not deletable through Remove;
there is no permanent-erasure or immediate retained-quota recovery promise.

## Limits

| Boundary                              | Limit                      |
| ------------------------------------- | -------------------------- |
| Files per message                     | 5                          |
| Original image                        | 10MiB /16MP                |
| Original UTF-8 text file              | 1MiB                       |
| Original XLSX/DOCX/PPTX               | 10MiB                      |
| Originals per message                 | 20MiB                      |
| Quoted text                           | 100,000 Unicode characters |
| Retained/reserved originals per owner | 1GiB                       |
| Local draft files per tab             | 40MiB                      |
| Preview cache / decoded images        | 20MiB /64MiB               |

Actual model dimensions/modalities and runtime ceilings can be stricter. No
silent resizing, truncation or dropping historical images is permitted.

### Compact native inputs and request memory

Cloudflare's SQLite row limit is not used as a new-image byte allowance. New
inputs freeze compact caption/reference metadata within128KiB and hydrate exact
private originals only for the proven provider request. The old1.75MiB inline
builder is not used for new sends; historical inline rows remain unchanged.

Worker memory, model image/context limits and the separate generation execution
profile can still refuse an otherwise valid upload. There is no silent resizing
or promise that a10MiB original fits every Worker request. See
[chat images and saved references](chat-images.md) for the4MiB generation/3MiB edit
profile, honest post-charge failures, per-chat library/@ behavior and accounting.

Models may also impose smaller image dimensions or encoded-byte limits. Existing
images in the authoritative model context must be compatible with the next
selected model. Choose another model or a new chat when they are not; changing
models never rewrites accepted history.

Source: [Cloudflare Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

## Saved references

Files contains accepted uploads and generated images, independent of loaded
transcript pages. Select exact same-chat files with @; saved references are frozen
separately from new uploads, never rebound or deleted when removed from a draft.
The existing five-file/20MiB input policy covers both. Archive keeps read access,
and missing originals keep identity with read-only Retry. Generated edits are
separate immutable files with source links; no persistent storage meter is shown.

## Setup and acceptance

Infrastructure declares one private stage-isolated bucket with public access,
custom domains and destructive force deletion disabled. This is source wiring,
not permission to provision/deploy. Review a plan and obtain approval before
applying cloud changes. Development must never reference production storage.

After explicit setup, verify owner isolation using two users, reload/archive
retention, picker/paste/drop, all file limits, invalid UTF-8/format/dimensions,
quota/concurrent reservations, duplicate UUID/content rejection, uncertain send
repair, preview resource cleanup and24h abandoned cleanup. Lose the retain
acknowledgment after native acceptance and confirm the same operation/probe
preserves the original. Builds/static checks do not prove R2 or deployed recovery.
