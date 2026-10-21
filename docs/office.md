# Office workflows — source and operational boundaries

The Office source implementation has passed its bounded independent source reviews.
The application image builds and runs locally. Genuine authenticated creation, native
loading, worksheet insertion and worksheet-name typing have reached revision ACK,
server drain and fresh-view persistence through Worker/Node/D1/R2. A real draft edit
also reached confirmed Ready, exact pinned snapshot HTTP200 and a real read-only
revision-2 result showing the edited worksheet name while Main stayed at revision1.
Two exact frozen-read boundary corrections resolved the earlier snapshot failure;
approval initially stayed disabled. A bounded merge-preview check then loaded both
exact read-only views and enabled approval, without approving or publishing anything.
Human Ready-only reopen reached exactly the next generation; a new editable View
accepted another worksheet-name edit, ACK, server drain and fresh-view persistence.
These are bounded cases, not full workflow acceptance.
**Cell typing, historical review readability, conversion/merge fidelity and AI
workflows remain unverified.** A CSV import returned an uncertain failure;
no replay or authority workaround is authorized. No approval, merge or AI inference
was performed.
Earlier test observers excluded redirected frame URLs or could trigger themselves;
those observations are qualified rather than attributed to an SDK defect. Corrected
input and bounded foreground checks still do not establish cell typing. Existing
testing authorization carries forward; no renewed generic permission is required.
Static checks and these cases do not prove all physical/concurrent schedules.

## Originals, AI and document history

1. Select XLSX, DOCX or PPTX originals and write a message. Nothing uploads until
   Send, and selecting/uploading never automatically creates an Office document.
2. Send freezes the original model/files/references and displayed editable target
   before native hold/drain and uploads. Retry retains that original tuple; it
   does not select a newer tab, head or generation.
3. AI tools may stage accepted originals, create new drafts, import into authorized
   drafts or perform supported edits. They cannot approve/merge or impersonate a
   Human. A reference, digest, schema, epoch or header is not authentication.
4. Existing Files retains the original downloads plus account-wide document/draft
   descriptors. Explicit import-history disclosures join real confirmed operations
   to original file IDs. One file may feed several drafts/documents; a document may
   have several originals. Equal hashes never merge distinct file identities.
5. History describes confirmed DRAFT IMPORTS, not proof that content reached Main,
   all semantic AI/code derivations or account documents belonging to the open chat.
   Unknown/failed operations and older missing identity do not fabricate links.

Office inputs share five files/20MiB per message and 1GiB owner accounting, with
10MiB per modern Office original. Accepted originals remain permanent under their
existing retention owner. Legacy XLS/DOC/PPT is not accepted in this attachment lane.
Office bytes are not decoded as chat text or base64 model blocks. See [private
files](chat-files.md) for storage, quotas, download authorization and uncertainty.

## Editing and Human review

Native editing stays inside the existing tools/Files tabs and same-origin frame.
A real View, acquired Editor and separate authenticated channel are required.
Save means actual native ACK plus server drain, not a green local label. Failed or
unknown saves/operations retain their mounted surface and original selector.

Ready freezes the exact draft for result/change/merge-preview review. Only a Human
may approve that exact result and publish; changed Main or incomplete evidence
must refuse. Check an uncertain ORIGINAL operation, never assume abort rolled it back.
Human reopen supports actual Ready→draft only, not merged/discarded worktrees.
Its confirmed null revision is not a guessed head. A separate explicit open checks
exactly the next generation and acquires a NEW View; old reviews remain immutable.

Bounded Sheet import-into refuses unsupported formulas/rich cells/resources/graphs/
history before allocation/publication rather than stripping content. Rich cross-
Doc/Slide append is not promised. Native create/import/render/export/save fidelity,
IME/body portals, responsive layouts and concurrent-user schedules need real user
acceptance on copies of non-sensitive files; no such acceptance is claimed here.

## One host architecture, existing storage

One Node/Univer application image supplies owner-scoped warm document-host roles
and separate fresh fixed-job roles. Browser code contains no provider clients or
secrets. Finite authenticated Worker callbacks use existing Office D1 metadata/R2
bytes; there is no mirror database, R2 FUSE/WAL assumption or second editor home.
Actual original session/input/target, prepared receipt, first ACK and FINAL fences
remain authoritative. Expiry revokes eligibility, not physical foreign IO ownership.

## Local image and safe build/restart

Run Docker, then `pnpm dev`. The local launcher prepares the real application
context, builds its Linux/amd64 `application` target, inspects the actual Docker
image ID and supplies `OFFICE_IMAGE_REF` itself. The local runtime uses that existing
immutable image directly: no application-image publication or registry pull.
Only the fixed `dev_local` stage accepts a local `sha256:<64 lowercase hex>` ID.
Cloud deployments still require an immutable Cloudflare registry application image
ending in `@sha256:<64 lowercase hex>` and remain separate approved operations.

Both forms must contain native-bootstrap plus fixed-job entries and match the
source/SDK/protocol provenance. A mutable tag, base-image digest or supplied string
alone is not proof of correct image contents or safe startup. Normal `pnpm build`
builds frame assets, Worker and types; the local launcher builds the Docker image.
See [apps/office](../apps/office/README.md) for its preparation/application target.
Do not implicitly run old smoke/hostile/SDK acceptance commands.

Stop the owned service BEFORE `pnpm build` or `pnpm dev`; never rebuild over live
assets. Preserve `.alchemy`, profiles and local data across restarts. Check actual
health and authenticated Office behavior after startup; static checks alone are
not a successful Office run. Local containers consume the Mac's CPU/RAM, not
Cloudflare container usage. AI inference remains remote and billable.
