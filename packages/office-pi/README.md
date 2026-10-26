# @starter/office-pi

Attachment-oriented Univer CLI for the application's Pi Durable registry.
It uses the shared native document server; it is not the unchanged local
`univer-cli` executable or Highsku's Workspace CLI.

## Model-facing interface

`makeOfficeExtension(host, display)` registers only:

- `get_attachments({cursor?})`
- `univer_cli({attachmentId, command: string[]})`
- `open_in_panel({attachmentId})`, when a display callback is supplied.

The legacy `office({request: ...})` tool is no longer registered. One bundled
Univer Skill supplies workflow and command guidance without version negotiation.
Commands are real Commander argv, never shell input. No user/owner, chat ID,
credentials, host path, backend address, Unit ID or worktree ID is accepted by
the tools. Worksheet/paragraph/slide IDs remain ordinary content selectors from
inspection.

```text
get_attachments({})
get_attachments({cursor: "<nextCursor>"})
univer_cli({attachmentId, command:["import"]})
univer_cli({attachmentId, command:["inspect","workbook"]})
univer_cli({attachmentId, command:["execute","-e","...Facade code..."]})
open_in_panel({attachmentId})
```

`get_attachments` proves its own tool call and accepted input, then lists the
saved library of that same bound owner and chat: ID, name, kind, media type and
byte size for ready files of every saved kind, with an opaque `nextCursor`. It
returns no file bytes, excerpts, owner or chat argument, and listing never grants
read, edit, approval or merge authority. `univer_cli` and `open_in_panel` still
act only on the explicit `attachmentId` they are given; displayed Send context
never overrides that target.

Use `command:["--help"]` for the actual command grammar. Supported operations are
import, status, inspect, execute, export, worktree ready/reopen and operation.
The application owns the CLI command program; existing official Univer headless,
inspection, execution, Exchange and Collaboration capabilities execute the work.
No custom local-file database or second collaboration authority is introduced.

## One original, one working document

An attachment must be either an immutable accepted upload/reference in the
executing input or a ready saved attachment retained earlier in the same chat.
Earlier files are therefore reusable without resending them: `get_attachments`
discovers their IDs, and `univer_cli`/`open_in_panel` resolve the requested ID
through the owner-scoped, same-chat catalog. Historical messages are never
rewritten to add an attachment, and a file id is a selector, not a grant.
`import` resolves that proven original, imports once and returns the saved
original operation. The existing explicit user opener uses the same operation
IDs: `file_open_<attachmentId>` and `file_upload_<attachmentId>`.

Root validates the owner-scoped operation, original digest/length, import options,
real document, Unit and draft before resolving a working target. A retained
original must still be ready, unexpired and readable in that owner's catalog;
removed, expired or unavailable files are denied rather than re-accepted. CSV,
TXT, XLSX, DOCX and PPTX use the shared import policy, so a CSV keeps its saved text
kind while remaining supported sheet input. TXT imports into native Docs and supports
`export docx` and `export txt`. TXT export is UTF-8 main-body text with LF line endings;
formatting, images, headers/footers and notes are not included. The original stays unchanged in
Files. Reopening the panel or issuing another CLI command never reimports it. A
discarded or merged draft is not silently replaced with a new import.

The CLI reads actual draft generation and a native View's revision before edits.
Human and AI changes therefore use the same native draft and existing revision
checks. Ready freezes a result for human review; only existing Human workflows
may approve or merge. `open_in_panel` proves the target before emitting navigation,
but success means requested, not rendered. Unsupported formats return
`UNSUPPORTED_PREVIEW` without changing the panel.

## Host and execution boundary

`OfficePiHost.resolve` proves the real native input/tool lineage and private
principal at every step. `OfficePiHost.attachments` proves the `get_attachments`
call the same way and reads only the chat bound to that accepted input. The
concrete host supplies:

- an authorized Office client and immutable upload capability;
- the proven attachment descriptor and Root-read original import receipt;
- an accepted original stream, never a model-provided file path or URL;
- a saved-library listing for the already proven owner and chat.

One CLI call can perform several internal server operations. Each has a private
step-scoped memo, intent digest, dispatch claim and lease bound to the actual
outer tool arguments. Source is represented by digest/length in those memos,
not duplicated as JavaScript. These are internal authorization operations, not
additional model-facing tools.

Facade source still runs in the existing fresh credential-free isolated job.
The CLI parser, runtime pool and worker process alone are not a JavaScript sandbox.
The trusted native host still owns revision admission and final persistence.

## Errors, cancellation and limits

Only confirmed receipts with accepted revisions prove saved edits. Pending or
uncertain import operations retain their original IDs; `import` reports them
rather than allocating another document. Duplicate execution callbacks observe
only their original receipt. Cancellation is not rollback or retry permission.
`operation` observes an exact operation from the same accepted input.

Tools use Pi defaults: 50 KiB or 2,000 lines, whichever comes first. Validated JSON
results above 50 KiB return an error rather than a silently shortened complete page.
Narrow inspection or use its real cursor. Chat previews use the same per-text limits;
redaction and aggregate response budgets can still limit the displayed content.
`get_attachments` also paginates and never claims a partial page is complete.
Document text is untrusted data. Existing upload/conversion/native limits remain;
this interface alone does not add 100 MB file support. CSV originals are compact
model references, not complete prompt text. Other text hydration remains unchanged.

Verification uses typechecks, lint, builds and source review. Live authenticated
discovery/import/edit/save/reopen and concurrent UI/AI behavior require user
acceptance; static checks alone do not prove native runtime operation. No unit
tests are required or authorized by this package documentation.
