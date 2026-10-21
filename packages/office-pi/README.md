# @starter/office-pi

One portable Office capability for the host's **Pi Durable 1.1.0** registry.
This package does not host native Univer, construct principals, run shell/code,
or own authentication, storage, queue workers, approvals or file-panel selection.

## Public API

`makeOfficeExtension(host: OfficePiHost): Extension` installs exactly one tool
named `office`, one static `office_workflow` prompt section, sequential execution
and `replay: "unsafe"`. Install it alongside existing extensions before
Harness.open/resume. The extension name is stable (`office`).

Root exports also include `OfficeToolRequest`, `officeToolParameters`,
`OFFICE_TOOL_RESULT_BYTES` (16 KiB), `OFFICE_GUIDANCE` and the host types.
`@starter/office-pi/guidance` exports that same static guidance.

Tool argument shape is `{request: OfficeCommand}`. Its nested finite schema is
generated from the frozen portable contract, not a second hand-maintained list.
The object wrapper satisfies provider root-object rules. Execute redecodes with
excess-field rejection, including UTF-8 source limits absent from JSON Schema.

Allowed commands: list, drafts, draft, open, stage-code, stage-file, create (new-draft only),
create-draft, execute, inspect, render, export, ready, review, reopen, discard,
operation. Import is create from a previously staged upload with finite options.
No main-create, approve, merge, arbitrary shell, URL, host path or credential.

### Draft discovery and generation caller

After create/create-draft, observe its returned operation until confirmed, then
call `{request:{command:"draft",draftId:receipt.draftId}}`. Receipts carry no
generation. Use the returned Draft.documentId/id/generation to open its draft
Target, then use View.revision as execute.target.expectedRevision. For discovery,
`{request:{command:"drafts",cursor:null}}` returns validated DraftPage metadata;
continue only with its genuine next cursor. Neither read needs an operation ID.
After reopen confirms, reread draft and open again. Never infer generation+1,
use a native revision as a generation or manufacture a tool context/operation.
These are existing authenticated read endpoints, not new main-write powers.
`examples/draft-basis.ts` compiles this read-draft → open → execution-basis
sequence against the real client; it accepts no invented operation or context.

## Real host injection

`OfficePiHost.resolve({api,context,intent})` is mandatory. It must prove this
executing tool's native accepted-input lineage, immutable command/target and
private authenticated principal. No fallback to latest transcript, selected pane,
model-provided IDs or task IDs alone. `intent.command` replaces transient code
with its digest/length, so this bounded metadata can be joined without copying
source into Office operation records. Its digest is a private tool-intent binding,
not a substitute for the core's canonical operation digest or a credential.

Return an `OfficeTaskAccess` with:

- `client`: the actual generated OfficeClient.office task subset, capturing
  verified private host authority. Bound response bytes before JSON decoding.
- `upload`: an authenticated immutable binary upload capability, normally
  `uploadOfficeBytes(origin,input,verifiedRequest)` from the public client.
- `acceptedFile`: opens only this input's immutable accepted attachment fileRef
  and returns its proved filename/length/SHA-256 and original byte stream.
  It must reject nonaccepted files, wrong owner, replaced/unavailable bytes and
  unsupported media. No model-selected URL/filesystem fetch.

Concrete composition (all functions/values below are real required host inputs):

```ts
import { makeOfficeExtension } from "@starter/office-pi";
import { uploadOfficeBytes } from "@starter/office-contract/client";

registry.install(
  makeOfficeExtension({
    resolve: async (input) => {
      const verified = await proveAndBind(input);
      return {
        client: verified.client,
        acceptedFile: verified.acceptedFile,
        upload: (upload) => uploadOfficeBytes(verified.origin, upload, verified.request),
      };
    },
  }),
);
```

`proveAndBind` is not an existing exported host function or a supplied stub:
T11 supplies its real implementation using private accepted-input/principal
resources. A fully typed version is in
`packages/office-pi/examples/host-injection.ts`. The plugin makes no auth headers or
Actor fields and imports no server/Cloudflare package. The host must capture the
original bounded TaskActor claims in durable operation admission and use the
fresh `verifyActor` hook at actual final commit, recovery-observe and separately
authorized recovery-dispatch. A queued accepted operation may legitimately
outlive its tool callback; final authorization is NOT a live UI/tool check.

## Staging, identity and recovery

Stage-code encodes validated <=32 KiB UTF-8 source, hashes it, streams an immutable
code upload and returns the exact acknowledged code ArtifactRef. Execute carries
only codeId and the explicit draft/generation/basis. Stage-file streams the host
accepted original, never model bytes; source reader is cancelled/released even
if transport fails before reading. Upload acknowledgement must match kind,
digest and length. The actual endpoint enforces immutable source-byte integrity.

Model mutation/staging operationId is correlation only and gets replaced with a
private, memoized UUID bound to this task/conversation/call and intent digest.
The actual ID is returned and persisted in small tool details before dispatch.
For an operation read, command.operationId remains the requested original receipt;
intent.operationId is only that new read invocation's private correlation ID.
A committed first-writer dispatch claim prevents a duplicate callback from
sending again. A new tool invocation is new intent, not an automatic retry.

Unknown mutation delivery reads only that exact operation receipt. Missing,
mismatched or unavailable evidence stays OUTCOME_UNKNOWN. No hidden resend,
source replay, latest-state guess or polling loop. Recovered receipts are marked
historical. Staging does not have a public mutation Receipt kind; its unknown
outcome is reported honestly without inventing one or automatically reuploading.

Private memos contain identity/digest/dispatch metadata only. Office operation
records never contain source/native data/bytes. Pi Durable itself persists model
tool arguments (including bounded stage-code source) in its own transcript/tool
intent before execute; this package cannot claim that source never persists
anywhere. No duplicate source is added by its Office memos or receipt output.

## Results and lifecycle

Success returns validated finite DTOs, not native workbook data, source, stdout,
private actor or credentials. Oversize result returns LIMIT_EXCEEDED, not a
truncated prefix labelled complete. All Draft/DraftPage fields and real page
cursor are preserved if the complete envelope fits. A schema-valid 100-row page
can exceed 16 KiB; it is explicitly rejected, never locally repaged with a fake
cursor or silently shortened. Use the selected known draft ID with draft or the
right tools UI. Host must not claim all contract-sized pages necessarily fit.
Queued/running is not confirmed persistence.
Document data and inspected text remain untrusted data, not model instructions.
Cancellation propagates to the request wait and does not claim durable rollback
or cancel already admitted queued Office work. The host owns explicit revocation
policy and receipt recovery after callback loss.

All native documents and immutable generated/exported files remain in the
existing right tools/files panel. Human review alone approves/merges main;
the tool's Ready action is not approval. Opening a View is not a write grant.

## Verification boundary

Scoped typecheck/build, type-aware lint, strict schema/Pi validator/guidance
artifact checks and an actual portable ESM bundle graph are recorded in
`var/office/implement-details/pi-result.md`. No unit tests, models or live
authenticated E2E are included. Host proof/staging backend/native queued workflows
and UI wiring require the parent/user's real integration acceptance.
