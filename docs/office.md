# Office workflows — source and operational boundaries

Earlier bounded runs verified native editing, revision ACK, server drain and fresh
reopening through Worker/Node/D1/R2, plus exact review and Ready-only reopen cases.
Those historical results do not certify later changes or all concurrent schedules.
Chat-scoped attachment access and selected-cell context require fresh user acceptance.
Never replay an uncertain import/write to test a fix. Static checks and HTTP200 alone
do not establish native save, conversion/merge fidelity or clean lifecycle behavior.

## Originals, AI and document history

1. Select TXT, CSV, XLSX, DOCX or PPTX originals and write a message. Nothing uploads until
   Send, and selecting/uploading never automatically creates an Office document.
2. Send freezes the original model/files/references and displayed editable target
   before native checkpointing and uploads. Retry retains that original tuple; it
   does not select a newer tab, head or generation. Opened attachment identities and
   selected worksheet/cell ranges are descriptive context, not read/write permission.
   Cells are identified by coordinates, not copied wholesale into the prompt.
   Explicit inline references suppress automatic displayed context; tray observations
   are never sent implicitly. Native Docs capture raw selected UTF-16 text. See
   [inline references](chat-files.md#inline-references-and-selections) for limits.
3. AI discovers saved chat files with paginated `get_attachments`, then uses
   `univer_cli({attachmentId,command:[...argv]})` and one bundled Univer Skill.
   Native inline sources use exclusive `referenceId` from the proven accepted input.
   A file need not be attached again to each message: the server resolves the retained
   original under the actual user/chat, never by trusting a model-supplied owner.
   The legacy `office` tool is disabled. This application CLI uses the
   shared native server, not a second local `.univer` database. `import` resolves
   an accepted original and imports once; later commands reuse that saved draft.
   Workbook/Unit and worktree IDs are server-resolved, not model-supplied.
   `open_in_panel({attachmentId})` requests that same imported draft after native
   validation. Unsupported formats return `UNSUPPORTED_PREVIEW` without navigation.
   Upload alone still does nothing. AI cannot approve/merge or impersonate a Human.
   A reference, digest, schema, epoch or header is not authentication. Panel
   requests expire after 30s, never replay on reload, and do not prove rendering.
4. Existing Files retains the original downloads plus account-wide document/draft
   descriptors. Explicit import-history disclosures join real confirmed operations
   to original file IDs. One file may feed several drafts/documents; a document may
   have several originals. Equal hashes never merge distinct file identities.
5. History describes confirmed DRAFT IMPORTS, not proof that content reached Main,
   all semantic AI/code derivations or account documents belonging to the open chat.
   Unknown/failed operations and older missing identity do not fabricate links.

TXT opens in native Docs through an application-owned UTF-8 import (optional BOM).
Line endings normalize to LF; native structural control characters are rejected.
Docs can export DOCX or TXT through the same authorized artifact pipeline. TXT is
main-body plain text: no rich formatting, images, headers/footers or notes. The SDK
handles text extraction, including its table text representation, not layout preservation.
TXT retains the existing 1MiB upload limit and its unchanged original download.

Office inputs share five files/20MiB per message and 1GiB owner accounting, with
10MiB per modern Office original. Accepted originals remain permanent under their
existing retention owner. Legacy XLS/DOC/PPT is not accepted in this attachment lane.
Office bytes are not decoded as chat text or base64 model blocks. See [private
files](chat-files.md) for storage, quotas, download authorization and uncertainty.

## Editing and Human review

Native editing stays inside the existing tools/Files tabs and same-origin frame.
CSV cards show a read-only content preview; Office cards show file metadata and
original downloads. Neither creates a draft. Explicit Open in panel imports through Human APIs.
AI import and manual opening share `file_open_<attachmentId>` and the same saved
working document; reopening never reimports the original or overwrites edits.
Repeated attachment clicks reuse its tab; resolved document/draft/generation opens
converge on that same mounted editor. Frozen review tabs keep separate identities.
Tab selection, Settings, pane visibility and switching chats leave retained editors
running in their own chat's workspace. Each open file admits only its own save/capture;
close saves its tab, and sign-out/account teardown awaits all retained saves.
Refresh restores descriptors through fresh authorization, never editor capabilities.
Unconfirmed imports expose an original-operation check. Known pre-write phases
also offer an explicit Continue original import using the same frozen input and
operation ID; uncertain native-write phases remain observation-only. Conversion
does not block navigation; reopening discovers the same operation without replay.
Archived chats cannot start a new import. Original downloads remain available.
A real View, independent Editor session and authenticated channel are required.
Editor sessions are not exclusive document/branch locks: another open does not
invalidate them, and expired historical sessions never prevent a fresh open.
An editable channel belongs to the real authenticated session, not one short
command or hosting lease. Mounted editors renew their identical Editor/View
through the existing authenticated API; renewal never changes revision/target.
Every protocol request proves the same session, and private callbacks revalidate
it. Actual native writes still acquire short placement-bound permits and final
atomic fences. SDK reconnects have independent member/cleanup ownership; a socket
close does not revoke another member or the entire logical browser channel.
Renewal failure persistently stops frame input without claiming an ACK. Native
transport is not periodically remounted or paused merely because a lease renewed.
Univer owns live OT, revisions, changeset deduplication, ACKs and socket updates.
Backend edits submit through the same document service; merely having an editor
open does not block them. Short atomic storage/authority fences still protect D1/R2.
Save means actual native ACK plus server drain, not a green local label. A later
confirmed server revision does not invalidate an earlier genuine save acknowledgement.
Failed or unknown saves/operations retain their mounted surface and original selector.

Ready freezes the exact draft for result/change/merge-preview review. Only a Human
may approve that exact result and publish; changed Main or incomplete evidence
must refuse. Check an uncertain ORIGINAL operation, never assume abort rolled it back.
New merge verification witnesses live in the owning operation record; legacy R2
witnesses remain readable. Do not roll back to older writers during an in-flight
merge: they do not preserve the new inline witness. No stored content is migrated.
Human reopen supports actual Ready→draft only, not merged/discarded worktrees.
Its confirmed null revision is not a guessed head. A separate explicit open checks
exactly the next generation and acquires a NEW View; old reviews remain immutable.
Native revisions remain authoritative. Isolated AI jobs retain their exact input
revision; native OT does not prove a computation based on older values is still valid.
Human approval remains bound to the exact reviewed result, not a moving live head.
Send briefly holds input for a fresh native ACK and captures the exact checkpoint,
then releases the local hold without draining the server Editor or replacing its
channel. The same active editor and authorization renewal continue. An explicitly
paused editor stays paused. If the ACK advanced beyond the opening View, the existing
open API captures a same-target checkpoint whose revision must equal that ACK;
a racing newer head refuses capture rather than changing the frozen AI input.

Bounded Sheet import-into refuses unsupported formulas/rich cells/resources/graphs/
history before allocation/publication rather than stripping content. Rich cross-
Doc/Slide append is not promised. Native create/import/render/export/save fidelity,
IME/body portals, responsive layouts and concurrent-user schedules need real user
acceptance on copies of non-sensitive files; no such acceptance is claimed here.

## One host architecture, existing storage

The application CLI supports import, status, inspect, execute, export, worktree
ready/reopen and exact-operation observation. Commands are argv, never shell input.
Private step-scoped task attestations replace model-managed staging; source code
still executes only in existing credential-free isolated jobs. Existing file and
native limits remain; this interface does not add 100 MB transport support.

One Node/Univer application image supplies owner-scoped warm document-host roles
and separate fresh fixed-job roles. Browser code contains no provider clients or
secrets. Finite authenticated Worker callbacks use existing Office D1 metadata/R2
bytes; there is no mirror database, R2 FUSE/WAL assumption or second editor home.
Actual original session/input/target, prepared receipt, first ACK and FINAL fences
remain authoritative. Staging failures expose only bounded phase/error labels and
submission uncertainty, never foreign messages or stacks. Upload observation reads
the native ACK ledger, not document-operation receipts; missing ACK remains unknown
and never permits replay. Expiry revokes eligibility, not physical foreign IO ownership.

## Local image and safe build/restart

Run Docker and build the application image explicitly with `pnpm dev:office`. It
prepares the real application context, builds the Linux/amd64 `application` target,
inspects the actual Docker image ID and prints it. `pnpm dev` never builds or pulls
an image: it inspects the existing `starter-office-local:dev` image, supplies that
immutable ID as `OFFICE_IMAGE_REF` to the `dev_local` Worker, and stops with an
instruction to run `pnpm dev:office` when the image is missing. Only the fixed
`dev_local` stage accepts a local `sha256:<64 lowercase hex>` ID. Cloud deployments
still require an immutable Cloudflare registry application image ending in
`@sha256:<64 lowercase hex>` and remain separate approved operations.

Both forms must contain native-bootstrap plus fixed-job entries and match the
source/SDK/protocol provenance. A mutable tag, base-image digest or supplied string
alone is not proof of correct image contents or safe startup. Normal `pnpm build`
builds frame assets, Worker and types but not the Office image. See
[apps/office](../apps/office/README.md) for its preparation/application target.
Do not implicitly run old smoke/hostile/SDK acceptance commands.

Restart `pnpm dev` after `pnpm dev:office` so the new immutable ID is bound.
Frontend-only work does not need that restart: run `pnpm dev:web` for Vite HMR at
http://localhost:5173 while the Worker keeps serving at 1337. Local Office hosts do
not retire when idle by default; `OFFICE_LOCAL_IDLE=true pnpm dev` opts into the
lifecycle check, and cloud `dev`/`prod` keep their existing idle policy.

Stop the owned service BEFORE `pnpm build`; never rebuild over live assets.
Metadata schema v2 retires the v1 exclusive-writer index without deleting
sessions or content. Stop the old runtime before this upgrade; mixed v1/v2 writers
are unsupported. Preserve `.alchemy`, profiles and local data across restarts. Check actual
health and authenticated Office behavior after startup; static checks alone are
not a successful Office run. Local containers consume the Mac's CPU/RAM, not
Cloudflare container usage. AI inference remains remote and billable.

## Failure diagnosis (source contract)

The diagnostic questions are: which admission check denied the original call;
which execution/storage dependency failed; whether the original outcome is
unknown; and whether physical cleanup completed. `office.admission` uses fixed
branch reasons with existing operation/task/call IDs, not document names or bodies.
Unexpected proof/callback failures propagate instead of becoming a denied null.
Office adapters keep legitimate error instances and native causes in memory;
public HTTP/tool/native-client replies encode code, message and operation ID, without retry directives.
Old denials do not permanently block fresh requested reads; current authorization still applies.
Legacy stored retry hints are ignored on read without rewriting history. New metadata omits them.
Rebuild/restart Worker and native image together; mixed old/new failure contracts are unsupported.

Fixed jobs emit bounded structured failures at their origin. Their existing stderr
stream is schema-validated, matched to the claimed job and relayed by its physical
supervisor. Raw stderr is never dumped; unstructured output produces only a fixed
marker. Invalid-input exits remain distinct from unexpected execution failures.
Claim-ACK loss still forbids dispatch; unknown writes remain observation-only.
Cleanup joins retain primary and secondary failures and never assert rollback.

Static checks do not establish diagnostic delivery. User-owned verification must
locate a safely authorized original failure by its operation/task/call ID in the
configured local/cloud sink, identify its branch/classification, check the safe
outward response and confirm actual cleanup. Operators use the local
stdout/stderr sink; the browser keeps the validated `x-request-id` plus safe
operation/status as a copyable reference and projects fixed phase/reason
records to the local browser console only (T17 local capture; no external
collector). Cloud-sink delivery, native job-log retention, and privileged
audit history are explicitly unverified and deferred; no new audit store is
added. Do not induce a paid/native write or
replay the historical uncertain upload merely to verify logging.
