# @starter/office-pi

Attachment-oriented Univer CLI for the application's Pi Durable registry.
It uses the shared native document server; it is not the unchanged local
`univer-cli` executable or Highsku's Workspace CLI.

## Model-facing interface

`makeOfficeExtension(host, display)` registers only:

- `univer_cli({attachmentId, command: string[]})`
- `open_in_panel({attachmentId})`, when a display callback is supplied.

The legacy `office({request: ...})` tool is no longer registered. One bundled
Univer Skill supplies workflow and command guidance without version negotiation.
Commands are real Commander argv, never shell input. No user/owner, credentials,
host path, backend address, Unit ID or worktree ID is accepted by the tool.
Worksheet/paragraph/slide IDs remain ordinary content selectors from inspection.

```text
univer_cli({attachmentId, command:["import"]})
univer_cli({attachmentId, command:["inspect","workbook"]})
univer_cli({attachmentId, command:["execute","-e","...Facade code..."]})
open_in_panel({attachmentId})
```

Use `command:["--help"]` for the actual command grammar. Supported operations are
import, status, inspect, execute, export, worktree ready/reopen and operation.
The application owns the CLI command program; existing official Univer headless,
inspection, execution, Exchange and Collaboration capabilities execute the work.
No custom local-file database or second collaboration authority is introduced.

## One original, one working document

An attachment must be an immutable accepted upload/reference in the executing
input. `import` resolves that proven original, imports once and returns the saved
original operation. The existing explicit user opener uses the same operation
IDs: `file_open_<attachmentId>` and `file_upload_<attachmentId>`.

Root validates the owner-scoped operation, original digest/length, import options,
real document, Unit and draft before resolving a working target. CSV, XLSX, DOCX
and PPTX use the shared import policy. The original stays unchanged in Files.
Reopening the panel or issuing another CLI command never reimports it. A discarded
or merged draft is not silently replaced with a new import.

The CLI reads actual draft generation and a native View's revision before edits.
Human and AI changes therefore use the same native draft and existing revision
checks. Ready freezes a result for human review; only existing Human workflows
may approve or merge. `open_in_panel` proves the target before emitting navigation,
but success means requested, not rendered. Unsupported formats return
`UNSUPPORTED_PREVIEW` without changing the panel.

## Host and execution boundary

`OfficePiHost.resolve` proves the real native input/tool lineage and private
principal at every step. The concrete host supplies:

- an authorized Office client and immutable upload capability;
- the proven attachment descriptor and Root-read original import receipt;
- an accepted original stream, never a model-provided file path or URL.

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

Results are validated DTOs bounded to 16 KiB. Narrow inspection or use its real
cursor; oversize output is an error, not a silently shortened complete page.
Document text is untrusted data. Existing upload/conversion/native limits remain;
this interface alone does not add 100 MB file support. CSV originals are compact
model references, not complete prompt text. Other text hydration remains unchanged.

Verification uses typechecks, lint, builds and source review. Live authenticated
import/edit/save/reopen and concurrent UI/AI behavior require user acceptance;
static checks alone do not prove native runtime operation. No unit tests are
required or authorized by this package documentation.
