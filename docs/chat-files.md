# Private chat files

Chat accepts JPEG, PNG, WebP and allowlisted safe UTF-8 text/Markdown/CSV/JSON/code
files. PDF, Office documents, archives, SVG, audio and video are not attachments.
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

Previews are on demand. Text is escaped and original downloads are forced to
plain-text attachment with `nosniff`, no-store and sandbox policy. Image originals
are served only as their validated image format. The model receives quoted
untrusted file text or native image blocks; visible user bubbles show the typed
caption plus compact file rows, not the full internal quoted file prompt.

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
| Originals per message                 | 20MiB                      |
| Quoted text                           | 100,000 Unicode characters |
| Retained/reserved originals per owner | 1GiB                       |
| Local draft files per tab             | 40MiB                      |
| Preview cache / decoded images        | 20MiB /64MiB               |

Actual model dimensions/modalities and runtime ceilings can be stricter. No
silent resizing, truncation or dropping historical images is permitted.

### Native SQLite ceiling

Cloudflare limits a SQLite row/string/BLOB to2MB. The installed Pi Durable
storage writes a complete native input into one row, without chunked images.
Therefore this starter caps serialized native input at1.75MiB with0.25MiB of
row-envelope reserve. Base64 overhead leaves roughly1.3MiB of original image
bytes per message, minus text and structure. A larger original can be staged and
previewed within the upload limits but cannot be accepted into the native
message; it remains unchanged/uncommitted and subject to abandoned expiry.
Choose smaller originals or remove files. The app does not downscale them.

Models may also impose smaller image dimensions or encoded-byte limits. Existing
images in the authoritative model context must be compatible with the next
selected model. Choose another model or a new chat when they are not; changing
models never rewrites accepted history.

Source: [Cloudflare Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

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
