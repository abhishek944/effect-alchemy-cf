# Office right-tool React surface

Reusable UI for the host's existing **right tools/files panel**. No Office page,
rail destination, file picker/tab system, chat replacement, authentication system,
router guard or generated-code execution runtime is included.

## Public exports

- `OfficeNativeEditor`: real SDK editor in a same-origin isolated frame.
- `OfficeEditorHandle`: `hold`, `flush`, `prepareToLeave`, `stopInput`, `resume`,
  `prepareCapture`, `validateCapture`, `revealCapture`.
- `NativeSelectionCapture`: immutable frame-local source, scope and content epoch;
  optional `OfficeNativeEditor.onSelection` reports completed native selections.
- `OfficeReview`: actual frozen result first; compact changes below, complete
  exact-changes and distinct merge-preview views; direct human approval.
- `OfficeDraftControls`: native hold → acknowledged editor drain → Ready.
- `OfficeRuntime` / `OfficeRunner`: injected authenticated client and Effect runner.
- `NativeUser`, `NativeTheme`, `FrameStatus`, component prop and save result types.
- `@starter/office-react/frame`: `mountOfficeFrame` for the separate native bundle.
- `@starter/office-react/styles.css`: scoped review/editor chrome using host tokens.

```tsx
import { useRef } from "react";
import {
  OfficeNativeEditor,
  type OfficeEditorHandle,
  type OfficeNativeEditorProps,
} from "@starter/office-react";
import "@starter/office-react/styles.css";

// Host supplies immutable View, real opaque channel, descriptive user and theme.
function SelectedTool(props: Omit<OfficeNativeEditorProps, "ref">) {
  const native = useRef<OfficeEditorHandle>(null);
  // Register native.current.prepareToLeave with the host's ONE existing guard.
  return <OfficeNativeEditor {...props} ref={native} />;
}
```

The host supplies
frame URL, selection, top-bar file tabs, Files/empty Tools state, theme mapping,
full view and narrow single-surface navigation. Do not add a second tab row for
files. Internal review tabs are the accepted result/changes/preview controls.

## Build and serve

`pnpm --dir packages/office-react exec vite build` builds the standalone
`dist/frame.html` and its required assets. Serve them from the authenticated
application origin and pass that URL as `frameUrl`. The host owns asset copying,
CSP/Access/authentication and final integration. No environment files are loaded
by this package's Vite config. Never deploy the local artifact page as a product.

`vite build --mode artifact` additionally builds `artifact.html`: genuine local
native SDK models with synthetic data and **no backend persistence**, and
`trace.html`: real SDK HTTP methods against an explicitly denying local fixture.
Neither is authenticated save/live/review/merge acceptance. Copy the entire frame
asset tree, including its genuine same-origin ES Docs layout Worker. Its public
capability/font checks must pass; no private or main-thread fallback is installed.
Slides replaces the public preset's OSS formula entry with the genuine Pro formula
plugin needed by Shape editor services. Native license watermarks are not hidden.

## Native identity and protocol

`View.nativeTarget` supplies actual Unit/worktree/generation identities. Never
alias application Document/Draft IDs to native IDs or rewrite native bytes.
Live main snapshots use the View-specific snapshot prefix below; main comb/socket
routes retain `/universer-api`. Draft uses the published Worktree configuration
helper. A server-issued opaque channel binds the global session-ticket endpoint. The server authenticates every protocol request/socket and validates
its owner/document/branch/generation/epoch; descriptive IDs are not credentials.

Pinned review uses the View's exact opaque protocol prefix, a read-only public
`ISnapshotServerService` override and `SnapshotService` loaders at its revision.
It never joins a live room. All write methods fail. Remote services are genuine
public SDK composition, not private injector stubs or a fake workbook endpoint.
Production permission reads and native image IO must be provided by the host's
scoped native service; no permissive/mock authorization fallback is included.
With `V=/api/office/views/<opaque View.id>/protocol`, the frame config supplies
`authzUrl=V/authz`, `signUrlServerUrl=V/images/{fileID}/sign-url`,
`uploadFileServerUrl=V/images/upload` and same-origin download endpoint.
Actual SDK requests proved the case-sensitive `{fileID}` substitution and authz
suffix `/-/object/-/batch_allowed` (both `allowed` and `batchAllowed`). Upload
retains native size/source/assign query parameters; Core must validate them.
Only owner/document-authorized immutable artifacts may map to authenticated
same-origin artifact-byte URLs. No arbitrary upstream/upload/download fallback.

The frame is CSS/runtime isolation, **not a security boundary for generated
code**. It runs only application/native SDK code. Origin, Window source, random
per-frame nonce and request IDs bind finite schema-validated messages. No native
content, operator credentials, executable source or arbitrary Facade command is
accepted through the bridge.

## Save, leave and lifecycle

Hold blocks frame-wide local input, including body portals, refuses IME
composition, finishes already-admitted native editing, seals local programmatic
commands and flushes actual native ACKs. Public command events and image-upload
counts are tracked from before unit loading; admitted async work must settle
before sealing and flushing. Missing completion or a 30-second activity timeout
refuses the barrier instead of guessing completion. Already-admitted work may
finish while local/portaled input remains blocked; keep that frame mounted. It returns `{ viewId, revision }` from
the native revision service, not a guessed save status. Read-only pinned views
return their verified exact revision. `flush` alone observes acknowledged saves;
use `hold`/`prepareToLeave` for transitions, not an unfenced flush.

Docs flush pending document changes through the public service. Slides completes
the public floating-editor session; if native drawing state still reports an
active text edit, hold refuses rather than clearing/discarding it through a
private API. Finish that native text edit and retry. Native integration must
verify all active-input, IME, portal, asynchronous command and save failure cases.

A failure keeps the frame/runtime/pending input held and open. Host must not
unmount, retarget or close as success. Only host authorization/editor lease
reacquisition may resume after server drain/revocation/epoch change. `resume`
releases a **local** hold; it cannot grant server authority. A fresh opaque
View ID scopes every owner/branch/epoch; callbacks, listeners and pending bridge
requests are fenced/disposed on replacement. Same-ID expiry may renew monotonically
without remounting; all other View fields must remain equivalent. Only future
bootstrap hints change, not active SDK state or server authority. The latest valid
theme is also retained for delayed boot/actual iframe reload. Late props synchronize
before bootstrap; normal SDK socket reconnect remains a separate unchanged path.
Hiding a tool must not cancel or
retarget an accepted operation. The host owns beforeunload/router decisions.

`OfficeDraftControls` requires the matching acquired Editor and Draft, validates
its descriptor, calls native hold, publishes the real drained revision, then
submits Ready once. Host must supply the matched target acquired from its actual
selection. Server remains authoritative for all write/drain/Ready predicates.

## Native reference capture

`onSelection(capture)` observes completed user Sheet ranges or one native Docs
text range. It never saves, attaches or sends context. Capture includes exact
`viewId`, `unitId`, local `contentEpoch` and raw scope; epoch is not a revision.
The host maps this to its authenticated attachment and retains its own tray.

For explicit Add reference, freeze that capture before awaiting:
`const ack = await handle.prepareCapture(capture)`. This checks the original
scope/epoch, performs the existing input-finish/hold/flush, rechecks, and leaves
input held. The host must checkpoint that exact source at `ack.revision`, then
`await handle.validateCapture(capture)` after checkpoint, before inserting its
immutable reference token. Resume in the host's existing guarded `finally` only
when its lease/uncertain-write rules allow it. Never stamp a View revision onto
local capture or replace it with a newer selection. Whole-native references use
`hold`, not a fabricated selection.

`revealCapture(capture)` requires the same live frame and unchanged content.
Show its pane first. It verifies exact SDK readback; hidden/deleted sheets are
not unhidden. Hidden/unlaid-out/offscreen unresolved targets fail explicitly.
Docs reject rectangular/disjoint/structural ranges, split surrogate pairs and
text over 4096 UTF-16 units. Sheets retain all 1–8 inclusive-coordinate ranges.
Programmatic reveal never creates a fresh tray observation. Local and remote
mutations invalidate captures; only the latest 64 observations of an unchanged
epoch remain frame-verifiable. Frame replacement/disposal also invalidates them.
No authenticated ACK/checkpoint or all offscreen/segment acceptance follows
from the isolated SDK diagnostics; the host owns those integration checks.

## Exact review and human publication

`OfficeReview` takes `client`, `run`, `reviewId`, `user`, `theme`, `frameUrl`,
`onOperation` and `onReceipt`; optional `onReopen` delegates selection/lifecycle
to the host. `run(effect,{signal})` executes an already authenticated Effect.

Changes load in bounded pages with identity/fingerprint/duplicate/count checks;
exceeding the 5000-change browser budget is explicit incomplete review, never
silent truncation. Complex changes open their exact frozen native context.
A loaded model/empty canvas alone never establishes native readiness: the frame
requires a real render unit, completed nonempty Doc layout, fonts and paint frames.
Native runtime failures fence success. Refresh cancels previous paging, clears
native-load evidence, and requires distinct full-result/preview role visits even
when the underlying immutable View IDs coincide.
Approval stays disabled for stale/conflicting/degraded/incomplete evidence,
unloaded full result/preview, or missing exact context. Actual result and preview
must load through separate pinned views, never live draft mutation loaders.

Only a trusted browser click/keyboard action starts approve→merge. The review is
freshly revalidated before issuing approval. Stable separate operation IDs are
announced through `onOperation` **before dispatch**; the host retains these
bounded IDs so navigation cannot hide an uncertain operation. Receipts are
validated against those identities. A lost response exposes Check operation;
it does not replay approve/merge/source code. Backend exact review/main fencing
is still required. `onReceipt` updates the host's existing files/tool projections.

One document per reviewable draft. A task can hold independent drafts/results;
there is no cross-document atomic merge or rollback promise. Main remains
separate from live same-owner human/AI draft edits until exact human publication.

## Verification boundary

Native SDK internal controls are vendor-owned. Preserve ribbon, Sheets formula
bar/footer, Docs navigation and Slides thumbnail/page controls; never recreate
native editing as HTML tables or server forms. Host CSS must not leak into the
frame or suppress its portaled keyboard focus.

Dark/light host tokens are retained. Native mobile/touch/IME support is not
promised: host selects one usable surface at narrow widths and offers full view
rather than squeezing a desktop canvas. The accepted 1440×900 four-panel
hierarchy and actual light/full/narrow behavior need final T11 app comparison.
No authenticated backend/E2E success follows from static checks or local units.
