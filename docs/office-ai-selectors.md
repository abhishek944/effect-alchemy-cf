# AI Office source and worktree selectors

## Model-facing contract

All Office tools use `attachmentId`, never a generic file `id` or `referenceId`.
`get_attachments` returns `attachmentId`. For uploaded files it is the immutable
original's UUID. Current-message native sources without an original association
use their document identity as the model-facing attachment alias. Root proves
that alias from the accepted input; it is not an account-wide document grant.
Stored reference occurrences and original identities are not renamed or migrated.

| Arguments                     | Selected target             |
| ----------------------------- | --------------------------- |
| `attachmentId`                | Main                        |
| `attachmentId` + `worktreeId` | That explicit working draft |

`worktreeId` is the application's public draft identifier (`Draft.id`). It is
not the SDK's physical worktree identifier or an authorization capability. Root
checks the selected draft belongs to the source document, owner and current
stage, and resolves its current generation. The model cannot choose a revision.
A displayed tab does not override explicit tool arguments.

## Import, create and edit

```text
get_attachments({})
univer_cli({attachmentId, command:["import"]})
// A confirmed import returns worktreeId. Use that exact value:
open_in_panel({attachmentId, worktreeId})
univer_cli({attachmentId, worktreeId, command:["inspect","workbook"]})
univer_cli({attachmentId, worktreeId, command:["execute","-e","...Facade code..."]})
```

Import still creates one initial draft and repeated calls reuse its original
operation, preserving edits. Before first publication there may be no Main.
For originals, the tool enforces confirmed import before opening/inspection and requires
an explicit worktreeId while Main is absent. Early reads return CONTENT_REQUIRED with
workflow state, nextAction and the exact nextCall for import or operation observation.
Confirmed import/operation responses return worktreeId and an inspect-worktree next action.
A known pending, failed or unknown import never becomes a new import attempt; observe
its exact operation. Missing receipt metadata fails unavailable, not import-required.
Already-native and published Main sources remain readable without another import.
No read silently imports or selects a different draft.

For an existing Main document, explicitly create a new worktree:

```text
univer_cli({attachmentId, command:["worktree","create"]})
univer_cli({attachmentId, command:["worktree","list"]})
```

Creation returns the new `worktreeId`. Listing returns only this document's
worktrees; follow its cursor for more pages. `execute`, `worktree ready` and
`worktree reopen` require `worktreeId`. No edit implicitly creates a worktree.
Human-only approval/publication remains unchanged. Main-only panel opens select
Main, not whichever worktree was most recently edited.

## Latest saved revisions and conflicts

Each new read/open resolves the selected target's latest saved native revision.
The backend binds subsequent steps of that command to the returned revision.
A change between read and write refuses/conflicts instead of silently rebasing a
calculation onto newer data. Main-to-worktree creation similarly captures and
checks its actual current Main checkpoint.

Human and AI edits share the same saved worktree. Unacknowledged browser input
is not a saved backend revision. Requests do not mutate original downloads or
historical prompt/checkpoint identities. Original and inline-reference metadata
is projected to clear attachment/worktree names only for the provider request,
after existing accepted-input proof; old stored content stays byte-identical.

## Results and operations

Tool results identify `attachmentId`, selected/created `worktreeId`, scope and
opened/accepted revision when available. Main has no worktree selector. Physical
SDK identities are not emitted as competing model-facing worktree IDs.
`operation` observes an exact original operation and remains historical; an
uncertain write never grants replay permission. Import receipts describe their
original acceptance, not the current working revision; use a fresh explicit
worktree read for current content.

## Verification limits

Source/type/lint/build checks do not establish authenticated native runtime
acceptance. On copies of non-sensitive data, verify import returns a worktree,
human edit then AI read sees the newest saved values, explicit Main read after
publication, explicit new worktree creation, two-worktree isolation, wrong-source
worktree rejection, Ready/reopen, and an intervening edit causing stale-basis
refusal. Check same-operation observation without replay. No unit tests are
required or authorized by this document.
