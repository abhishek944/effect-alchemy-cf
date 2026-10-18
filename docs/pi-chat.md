# Pi Durable chat

The signed-in dashboard connects its existing assistant-ui primitives to a small
same-origin chat API. Cloudflare `PiHarness` hosts Pi Durable in SQLite-backed
Durable Objects; Pi owns transcripts, in-flight work and recovery checkpoints.
The application owns private chat metadata and authorization.

The initial model is **GPT-6 Luna / High**. Installed OpenAI and Anthropic models
and supported reasoning levels are selectable through an explicit stage allowlist,
with per-chat settings and account defaults. There are no tools, shell or workspace.
See [models and usage](chat-models-usage.md), [private image/text files](chat-files.md)
and [manual dictation/read aloud](chat-voice.md). Queueing, Fast and PDF are absent.
Titles use one bounded first-send-model naming call; see [automatic titles](chat-titles.md).

## Chat lifecycle and identity

Each application user has private saved chats with public UUIDs. `/chat/{chatId}`
addresses one saved chat, including reload and Back/Forward. This UUID is not the
object-local Pi root session ID: each private chat object uses root session "1".
A URL never bypasses sign-in or owner authorization.

New chat, switching, rename and
archive/unarchive are supported. Archive moves a chat into the Archived group and
blocks new sends and hides the composer; **it does not erase its transcript**.
The archived notice includes Unarchive. An existing answer continues with an
external Stop action, rather than being cancelled by archiving. There is no Delete control or permanent-erasure promise. Pi Durable
currently lacks a native conversation-deletion API; account-data erasure needs
an explicit future storage lifecycle design.

Every list/read/submit/stop/update/events operation resolves Better Auth identity
on the server. Browser-supplied user IDs are not trusted. Cloud development still
uses Cloudflare Access before application authentication; local development uses
ordinary Better Auth signin with separate local users/storage.

Text submission acknowledges durable acceptance rather than holding the request
until inference finishes. A stable operation ID prevents duplicate submission
when the same user action is retried. The selected chat receives atomic initial
and reconnect snapshots, including any partial assistant answer. Disconnecting a
browser stops its stream, not durable model work. **Stop** targets the observed
operation ID only; a delayed Stop must never cancel a newer answer. Real setup,
provider and run errors are shown rather than fabricated replies.
Streams reconnect at least every five minutes to revalidate authentication.
Paid submissions are bounded per user across chats: ten per minute, plus six
expiring reservations over five minutes. Reservations are approximate, not an
exact count of active runs; completed runs may still occupy capacity until expiry.
Retries bind the operation ID to the original chat, text, model, effort and ordered
file UUIDs. One active response is allowed; busy sends are rejected, not queued.
Exact native acceptance
is checked before quota, so a lost catalog acknowledgment can be repaired without
another submission. Rejection releases only its owned tentative reservation.
Stop resolves the exact native input/run task, not whichever answer is now active;
its acknowledgment can be a settled no-op and is not proof the provider stopped.

## Bounded progressive reading

Snapshots retain at most 80 committed rows plus one live row, with exact prefixes
of at most 512 UTF-16 units. Use **Load older**, **Load missing messages** and
**Return to latest** to navigate history. Message text loads automatically without
expansion or section buttons. Reads are serial, capped at 128 pages per message
revision and the shared browser text budget. Failed reads and messages too large
to fit show a notice; reload to retry rather than loop or hide missing text.
Old native public user/assistant history remains readable after compaction.
Entire snapshot/history/SSE frames are capped at 128 KiB; text pages at 32 KiB.
The selected browser view retains at most 400 message identities and 2 MiB of
accounted text, including retained prefix versions. Evicted ranges can be reread.
Live text revisions can expire: refresh rather than combine mismatched chunks.
These application limits do not bound native full-record hydration or total DO
heap. Native cancellation-to-ledger crash timing and deployed recovery still
need live acceptance; static checks cannot prove them.

## Activity and reply copying

A live, identified run shows inline **Working** dots before its first answer text.
Reconnect, Stop-in-flight and errors override that activity; dots are static with
reduced motion. This is run-state feedback, not private model reasoning.

Assistant replies have icon-only **Copy response** at the bottom-right and
**Copy code** at each code block's upper-right. Both require complete, committed,
same-revision text and remain disabled during runs, reconnect, loading or errors.
Display limits never permit copying a prefix as the full reply. Clipboard success
briefly shows a check; failures are announced without claiming success. Reply
copy preserves original Markdown; code copy uses only the parsed code text.

## Why not react-pi?

`@assistant-ui/react-pi` is a browser-safe adapter for the Node Pi coding-agent
contract. Its supplied Node host cannot run as a durable Cloudflare backend.
Pi Durable has different snapshot/event shapes and capabilities. This starter
reuses `@assistant-ui/react`'s external-store runtime instead of building the full
PiClient compatibility layer. No Pi/provider/infra client or credential enters
the browser bundle.

## Development Gateway and BYOK

Cloud development declares the Alchemy resource `ChatGateway`, with gateway ID
`servicestarter-dev-chat` (derived from the service name). Local mode declares no
Gateway. Local `CHAT_GATEWAY_ID` must exactly match that development ID; blank or
another value disables inference. Production requires a separate non-dev ID or
fails closed. Both managed Gateways disable caching and request-log collection.
The managed development Gateway requires authentication. The native Workers AI
binding uses its Cloudflare account identity; no Gateway token belongs in browser
configuration. Direct API callers require a suitable Cloudflare token.
The enabled vendors' **default BYOK aliases** must be provisioned securely by you
in Cloudflare AI Gateway. Catalog presence is not proof of account eligibility.
Do not put an OpenAI/Anthropic key in source code,
`packages/config/.env.*`, browser variables, chat messages or command logs.
Deployment provider credentials remain in Alchemy profiles.

Before live use:

1. Stop the old local dev server before rebuilding its frontend assets.
2. Run `pnpm lint` and `pnpm build`.
3. Review `pnpm plan:dev`. Obtain deployment approval before `pnpm deploy:dev`.
4. Configure enabled vendors' default BYOK aliases securely in Cloudflare and
   verify each allowed model's eligibility. Builds/checks do not provision keys,
   purchase credits or call models.
5. Set nonsecret `CHAT_GATEWAY_ID` and exact JSON `CHAT_MODEL_ALLOWLIST` in
   `packages/config/.env.dev`; see the linked setup guides for private files and
   optional development OpenRouter voice key. Start `pnpm dev` with the dev profile.
6. Sign in and send a short message only when you intend to incur model usage.

Local Worker, auth and durable chat storage remain local. **Inference is always
remote and billable**, even with localhost UI. Missing local gateway configuration
must not attach a remote AI proxy silently; chat sending returns a clear setup
error until configured. Review remote bindings before starting changed stacks.
Local startup reads chat Gateway/model and billing catalog/account settings from
`.env.dev`, never `.env.prod`. Inherited chat settings are replaced.
Blank/non-dev Gateway IDs disable inference; a missing model allowlist fails closed.
Voice uses OpenRouter separately; its optional private development key profile
is documented in [voice setup](chat-voice.md). It never uses the chat Gateway.

Production must use a separate Gateway ID in `packages/config/.env.prod` or fail
closed for inference. Leave it blank until provisioned; never reuse the dev ID.
Never point local/dev at a production gateway. Production
Gateway/key provisioning is not approved by the development feature plan. CI's
production environment can provide the nonsecret `CHAT_GATEWAY_ID` variable;
PR checks receive no credentials and do not provision resources.

## User-owned acceptance checks

1. Without signin, every `/api/chats` operation returns unauthorized.
2. Create two chats; send distinct text, switch, refresh and confirm private history.
3. Rename, archive and unarchive; archived history persists and no Delete exists.
4. Start a reply, reload/reconnect and confirm one partial/final answer without
   duplicate text; closing one browser tab must not abort durable work.
5. Stop a running reply; confirm state settles and a new send is possible.
   Repeat Stop and deliver an old Stop after a newer run begins; the newer run
   must remain active. An actual Stop failure must stay visible.
6. Retry the same operation ID after an interrupted acknowledgment; confirm no
   duplicate accepted input or extra model run. Reusing it with different text,
   selection, file IDs or chat must fail, including after reservation expiry.
7. Use a second application user and verify another user's chat UUID reveals no
   data, including events and mutations. Cross-origin mutations must be rejected.
8. Restart local dev and confirm chats persist with local storage preserved.
9. Inspect missing Gateway/BYOK, provider failure and reconnect states. These are
   real errors, not an assistant message claiming success.
10. Inspect narrow layouts, keyboard focus and chat actions in the approved dark
    sidebar, then confirm Settings/admin/companion-pane behavior is unchanged.
11. Keep a draft in each chat. Switch during a pending send and during reconnect,
    then return; each draft and failed-send recovery must belong to its own chat.
    A blocked or overlength send must preserve the draft, not silently consume it.
12. Send identical text in separate operations/tabs. An unrelated run or message
    must not settle another operation's pending state. Retry keeps the same UUID.
13. Switch A/B/A rapidly and reconnect manually; cached history must not enable
    Send before the new attachment receives its authoritative snapshot.
14. Rename/archive concurrently and reverse response timing. The list and open
    chat must agree with authoritative metadata, including Unicode titles.
15. Disconnect all viewers before a model failure or completion. Reopen the chat
    and confirm the durable outcome and original user-message operation identity.
16. Inspect multi-block partial answers, retry state, replacement snapshots and
    long history/slow connections. No text may duplicate or disappear, and size
    limits must provide explicit recovery rather than an endless reconnect loop.
    Page older/missing ranges and confirm automatic message expansion preserves
    the beginning, stops safely on errors/limits, and does not refetch evicted text.
    A smaller same-revision preview must not remove or duplicate fetched text.
17. Check malformed/oversized JSON, missing or inaccurate Content-Length, empty
    patches and archived sends. Limits must reject safely before expensive work.
    Inspect all chat errors for private no-store caching and safe messages.
18. Across two tabs, race an old Stop against completion/new submission; only
    its exact run may be targeted. Reconcile during Stop; actual cancellation
    must not become a model failure, and false/failed Stop must not hide one.
19. Lose catalog finalization after native acceptance, expire its lease and
    fill capacity; retry the original UUID without another charge/submission.
    Delay an old Busy release until a newer attempt accepts; its lease must stay.

Local checks do not prove deployed eviction/alarm recovery, account billing,
model eligibility, Access/HTTPS or production compatibility. The approved + New
sidebar control was compared at its exact viewport using an isolated browser
source fixture; this does not establish signed-in live UI or deployed parity.
