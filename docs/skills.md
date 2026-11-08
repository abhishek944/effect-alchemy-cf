# Private chat Skills

**Current runtime:** skill originals are verified and stored by the local object store. See [runtime](runtime.md). The sections below that
describe the removed stack are historical and no longer describe how this repository
runs.

## Product contract

Settings → Skills is one private instruction library for the signed-in user,
shared by that user's chats. Upload one `.txt` or `.md` file at a time. The list
shows full filenames and Download; there is no body preview, editor or detail page.
Markdown frontmatter is not required. ZIPs, executable scripts, supporting files
and skill-image resources are not accepted.

The same normalized filename needs explicit Cancel/Replace confirmation. Replace
supplies the version the user confirmed; a newer version from another tab cannot
be overwritten silently. Original spelling/bytes remain exact. Filename matching
uses NFC normalization and lowercasing.

An interrupted upload response is not proof of failure. Retain the same upload
identity and inspect its receipt before replacing it. A known publication remains
acknowledged even if list refresh fails. Only an authoritative list read proves
current library contents. Checking a receipt never replays an upload.

## SDK activation and lifecycle

A new distinct Send verifies a fresh owner-scoped immutable library snapshot
before acceptance. An unavailable/unverifiable library blocks admission without
losing the draft. The model receives a short catalog and activates instructions
on demand with `skill(name)`. The direct Pi SDK extension registers that tool;
its Worker callback returns the full exact approved instruction document.

An active response retains its prepared snapshot even if the user replaces a
library file. Activation validates owner and operation, uses only the prepared
documents and enforces the existing combined active-guidance budget. Unknown
names produce an ordinary tool error. A known document that cannot be verified
or activated is fatal: the response stops, retains partial/finalized output as
incomplete and does not silently continue with stale or empty instructions.

A later Send retires prior Skills tool-result instructions from model history
and advertises its fresh approved catalog. Visible transcript is not deleted,
earlier account/file actions are not undone, and semantic forgetting is not
promised. Prior tool results, quoted documents and summaries are not standing
authority. No YAML parser, local filesystem skill discovery, shell or executable
resource support is added to the application.

Before acceptance, the Skills unavailable notice preserves the draft and its
Try again action only checks readiness. It does not send or alter the model. The
existing 15-second readiness deadline and disabled-while-checking control remain.

**Checkpoint recovery has been removed with the old runtime.** There is no
original-version automatic resume or accepted-operation re-execution. A host/
object process loss makes accepted work unanswered; retrying that same message
UUID only repairs its receipt. Old permanently rejected UUID tombstones remain
fenced. The old `/skills/retry` and `/skills/new-send` commands explicitly refuse
checkpoint recovery. To start new work, use a new explicit ordinary Send with the
current library. This does not roll back or replay earlier mutations or files.

## Ownership and storage

- `skills-model.ts`, `skills-manifest.ts` and the existing catalog/storage helpers
  own filename keys, immutable manifests, scope-bound digests, original bytes,
  expected versions and publication receipts.
- `chat-sdk-skills*.ts` verifies one snapshot and owns operation-scoped activation.
- The Node SDK host owns the direct extension/session lifecycle. Its run-scoped
  callbacks cannot select another owner, operation, catalog or private original.
- The conversation owns acceptance, Stop, transcript and accounting. Browser
  code imports no provider/SDK/infra client or secret.

HTTP contracts remain:

- `GET /api/skills[?uploadId=UUID]`: current verified list and optional receipt.
- `POST /api/skills?filename=...&uploadId=UUID[&replaceVersion=UUID]`: raw bytes,
  not multipart; returns the publication acknowledgement.
- `GET /api/skills/download?id=UUID&version=UUID`: private attachment download.
- `POST /api/skills/cancel?uploadId=UUID`: fences an unresolved upload; a known
  publication keeps its receipt. This is not Delete for a published file.

Authentication chooses owner identity; mutations require the application origin.
Downloads remain attachment/nosniff/sandbox/same-origin and non-cacheable.
Stored-manifest corruption and storage errors are failures, not missing Skills.
Diagnostics use fixed safe classifications, never raw bodies or secret values.

## Existing bounds preserved

- 64 KiB valid nonempty UTF-8 per file and bounded printable filenames.
- 32 current files; 512 live retained/reserved versions.
- 64 MiB retained/reserved originals; 4,096 cumulative upload intents including
  permanent expired tombstones. Known receipts still work at the cap.
- 56 KiB combined active state/rendered guidance. Nothing is silently shortened;
  a valid upload may still be too large to activate with other instructions.
- Existing permanent New Send rejection records remain readable and are never
  evicted or revived by a normal Send.

Publication rechecks the fresh candidate/head and atomically promotes its rows.
Original PUTs stay create-only. Retirement applies only to unpublished originals,
uses a permanent marker and preserves the expired intent against late writes.
Quota is released only after confirmed retirement. Current published originals
are not silently selected for cleanup.

## User-owned verification

After explicit setup, verify two-user isolation, exact downloads, interrupted
publication receipts, concurrent Replace conflicts, readiness/draft preservation,
activation, guidance budget failure, replacement during a response, a fresh
library on the next Send, exact Stop, retained incomplete output, no automatic
paid replay and truthful model/tool usage. Verify old rejected UUIDs cannot run.

Typechecks/lint/builds and no-network SDK construction do not prove deployed
Access, provider/R2 behavior, real billing or native cancellation timing. No unit
tests, live interactive end-to-end run or deployment is implied. See
[Pi chat setup](pi-chat.md) and [observability](observability.md).
