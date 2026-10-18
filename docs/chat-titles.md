# Automatic chat titles

New chats start as **New chat**. After the first user message is durably accepted,
the catalog immediately installs a short message excerpt and claims one additional
background naming attempt. The answer does not wait for that model call. Manual
names remain authoritative; there is no backfill, regenerate button or automatic
retry. Files-only input without a typed caption keeps New chat until renamed.

## Model and limits

Naming uses the first native-accepted send's actual frozen model, after validating
the stage allowlist, through the same Gateway boundary. It is not a cheaper fallback
model or another public conversation turn. It never changes the reply configuration.
Naming uses off, otherwise the model's lowest supported reasoning level, no tools,
at most2000 Unicode input characters and64 output tokens with a10-second abort
signal and one SDK/Gateway attempt. Provider-specific OpenAI/Anthropic guards
verify the actual wire caps/effort before dispatch. A provider requiring budgeted
thinking has an additional bounded1024-token reasoning allowance.

The prompt targets 3–6 words, matching the first message's main language, with a
60-Unicode-character maximum. Only the first user message is input; neither the
assistant answer nor later messages is sent. Plain one-line output is sanitized;
malformed, incomplete, structured, Markdown or emoji output keeps the excerpt.
Word count is a prompt target, not an English-only validation rule.

## Ownership and failure behavior

The owner-scoped catalog stores explicit eligibility, claim and manual-name
provenance. The conversation proves that this operation is the oldest native
accepted user input. Fresh acceptance and an exact accepted retry use the same
atomic claim; rejected/busy/unconfigured sends do not dispatch naming work.
The title amount claim is persisted before paid work; inability to attribute it
skips the optional call. The actual response upgrades that claim's reported counters
and estimated cost without duplicating totals. Unknown costs remain Partial/Unknown.

Any manual rename wins, even renaming back to New chat. A delayed generated name
cannot revert an archive or a manual name. Writes retain monotonic metadata time.
Provider errors, invalid output, timeout or interrupted background work quietly
keep the excerpt and cannot replace the answer or block Send. A crash before the
claim can leave New chat until an exact retry; a crash after the claim can leave
the excerpt permanently. This deliberately favors bounded cost over guaranteed
naming, and is not an exactly-once vendor-billing guarantee.

The browser reads catalog metadata immediately and at a finite 2s/6s/12s window
after accepted sends, initial attachment or a newly observed native operation.
Windows coalesce, stop after those reads and clean up on account change/unmount;
there is no ongoing poller. Timestamp/epoch guards update both sidebar and open
chat metadata without overwriting newer rename/archive changes.

## User-owned acceptance

After explicit billable-inference setup, create a new chat and send a short
message. Expect the excerpt, then a short title without reloading or interrupting
the answer. Rename while naming runs, including to New chat; the manual name must
remain. Archive while naming runs; it must stay archived. Retry the same operation,
reload and send another turn; none should generate another title request. Existing
chats must retain their titles. Provider failure should leave the excerpt quietly.

Inference remains remote and billable on localhost: a first message can now incur
one answer call and one naming call. No paid acceptance call was run while
implementing this feature. Local checks/static adapter inspection do not prove
vendor payload delivery, real cancellation timing, eviction recovery or account
model eligibility. See [Pi chat setup](pi-chat.md) before live use.
