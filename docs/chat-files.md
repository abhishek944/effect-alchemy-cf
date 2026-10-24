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
local originals for send recovery or removal. Composer cards show a local content
preview, filename, individual size and Remove, with a neutral border in all five
themes. Click the thumbnail to preview; there is no separate Preview button.
Previewing never uploads a file or imports an Office draft.
Failed files keep their explanation; remove and reattach files that cannot prepare.
Frozen sends keep Remove disabled until their outcome settles.

An accepted message retains private originals across reload/archive. Metadata and
quota live in the owner's catalog actor; bytes live in the stage's private R2
`ChatFiles` bucket. Object keys include the real owner actor's identity, not just
browser-supplied chat/file IDs. No public domain, public URL, CORS, provider key,
base64 payload or owner identifier is exposed in the public descriptor/history.

Visible Files, sent-file and reference thumbnails show content when available.
Loading, unavailable, empty or complex thumbnails show a quiet file icon, not prose.
Images retain exact right-panel tabs. Text/code show escaped readable excerpts;
CSV shows quoted-field-aware table previews. Click a non-image card for a larger
read-only preview; text source links and Open in panel use a text preview tab.
Office previews show file metadata, original download and explicit Open in panel,
without reading or parsing private Office bytes in the preview. Native formatting
is available after an explicit Office open, not through a semantic thumbnail.
Explicit CSV/Office Open in panel or AI `univer_cli` import creates a Univer draft.
Manual opens stage the retained original server-side using authenticated chat/file
identity; private bytes no longer download to the browser and upload back.
The saved original and Main stay unchanged. Reopens reuse the same owner-scoped
import operation; unconfirmed imports offer Check original operation, not a new job.
They do not block workspace navigation: reopening the file discovers that same
operation rather than replaying an uncertain import.
Text originals download as plain text; Office originals retain their declared
binary media type and filename. Downloads use attachment, `nosniff`, no-store and
sandbox policy; images retain their validated inline format. At the proven model
request boundary, non-CSV text becomes quoted untrusted text and images become
transient native image blocks. CSV/Office contributes compact file references,
never complete CSV rows or binary model blocks. The attachment-ID `univer_cli`
imports once and works on the same native draft used by manual/AI panel opens.
Visible bubbles keep the caption and compact file rows. No complete file body is
stored in new native inputs. Attaching/uploading alone never creates a document.

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
| Quoted non-CSV text                   | 100,000 Unicode characters |
| Retained/reserved originals per owner | 1GiB                       |
| Local draft files per tab             | 40MiB                      |
| Preview cache / decoded images        | 20MiB /64MiB               |

Actual model dimensions/modalities and runtime ceilings can be stricter. No
silent resizing, truncation or dropping historical images is permitted.

### Compact native inputs and request limits

Cloudflare's SQLite row limit is not used as a new-image byte allowance. New
inputs freeze compact caption/reference metadata within128KiB and hydrate exact
private originals only for the proven provider request. The old1.75MiB inline
builder is not used for new sends; historical inline rows remain unchanged.

There is no app-side RAM estimate or reservation gate. Cloudflare may still
fail a request at its real runtime memory limit. Model image/context limits,
file/body limits and storage quotas remain; there is no silent resizing or
promise that a10MiB original fits every request. See
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
