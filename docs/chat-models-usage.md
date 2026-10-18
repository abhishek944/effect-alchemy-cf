# Chat models, reasoning and usage

The chat uses the installed Cloudflare OpenAI and Anthropic catalog, not arbitrary
vendor identifiers. Model metadata is not proof your account can use that model.
Configure the appropriate default BYOK alias in the development Gateway yourself.
No provider key or provider client belongs in browser code.

## Stage allowlist

`CHAT_GATEWAY_ID` and `CHAT_MODEL_ALLOWLIST` are separate nonsecret settings in
`packages/config/.env.dev` / `.env.prod`; both files must have identical keys.
The allowlist is a JSON array of exact catalog IDs. Example enabling only the
confirmed installed initial model:

```dotenv
CHAT_MODEL_ALLOWLIST='["openai/gpt-6-luna"]'
```

Choose additional exact IDs from the authenticated `/api/chat/capabilities`
catalog and verify account eligibility separately. Missing/malformed configuration
disables model selection/sending; an empty array deliberately enables none.
There is no automatic model fallback or inferred entitlement. Development never
uses a production Gateway. Production requires its own allowlist/Gateway/BYOK
setup and approved deployment. Production CI settings belong in its production
GitHub environment, never unprivileged PR checks.

## Preferences and direct Send

Initial preference: GPT-6 Luna / High. Each chat retains its own model and effort;
an explicit change also becomes the account default for newly created chats.
Effort is remembered per model. First use prefers High, otherwise the highest
supported level at/below High with a visible adjustment. Unsupported saved choices
need explicit repair; never silently substitute an available model or effort.

Writes use expected revisions. A stale tab refreshes after conflict rather than
overwriting another tab's newer selection. Settings are account-synced; visual
theme remains independent.

There is one direct Send and exact-operation Stop flow, with one active response
per chat. A busy send is rejected, not saved as waiting work. No message queue,
waiting editor, reordering, pause/resume, Fast control or compatibility path.
The selected model, effort and file IDs are frozen per send. Later preference
changes affect the next send, never the current response or its checkpoint.

Retry uncertain acceptance with the same operation UUID and complete original
text/selection/ordered file IDs. Changing any part requires a new send identity;
a previously accepted retry repairs metadata/retention without another model run.
Stop targets the observed native operation, never whichever reply is newest.
Enter and Send share the same admission path for text or ready staged files;
Shift+Enter remains a newline. Blocked submissions keep their text and files.
Catalog failures are visible beside the controls with Retry, and a missing-catalog
model popup explains the failure instead of opening nothing. Loading is distinct
from a loaded catalog that does not contain the saved model.

## What the numbers mean

Response facts use the actual committed response's reported input/output/cache
and available reasoning counters. Cache tokens are included only once in total
input. Reasoning is already a subset of output, not another additive category.
Live/uncommitted responses are Pending, not a fabricated zero-cost answer.

The bottom tray shows estimated authoritative server-context tokens against the
selected model's actual context window and estimated chat spend. It does not
estimate from the browser's bounded message window. Selecting another preferred
model invalidates the old ratio without reconfiguring an active response.

Prices are installed catalog estimates, including supported price tiers, not an
invoice or account-billing guarantee. Missing counts/prices are Unknown; known
subtotals with missing work are Partial. Failed, stopped and retried work may still
cost money. Reply, title, summarization and speech work remain separately
attributable. Speech retains real seconds/characters/tokens, never fake context
token equivalents. Dictation before a chat exists remains account-attributable
rather than being charged to an unrelated chat's display.

Titles use one bounded background call with the first accepted send's actual
model and off/lowest supported effort. See [automatic titles](chat-titles.md).
No extra provider request is made merely to calculate a displayed estimate.
Context and Cost open the same ledger above the composer. Escape returns to the
button that opened it; pointer dismissal leaves focus on the clicked control.
Leaving the usage host by keyboard closes it before another picker opens.

## User-owned acceptance

After explicit Gateway/BYOK/allowlist setup, verify model eligibility, every
supported effort, preference conflicts across tabs, new-chat inheritance, native
streaming/reconnect/Stop and same-UUID repair. Inspect reported usage and provider
billing separately, including retries/failure/stop, title and summarization.
Static checks and anonymous rendered fixtures do not prove paid delivery,
eviction recovery, account billing, authentication or production behavior.
