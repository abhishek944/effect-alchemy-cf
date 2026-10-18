# Dodo and Polar billing setup

Billing is optional and disabled by default. It uses the existing API Worker,
auth D1 and account settings page; no billing database/service must be provisioned.
Official SDK versions are pinned: `dodopayments` 2.54.2 and `@polar-sh/sdk` 1.0.2.
See [the reviewed design](billing.md) for ownership, retries and access policy.

## 1. Products and nonsecret configuration

Create hosted-checkout products in Dodo and/or Polar, separately for test/live.
Edit the selected private stage file in `packages/config/` (never commit it):

```dotenv
BILLING_PROVIDER=dodo
DODO_ACCOUNT_ID=your_test_business_id
POLAR_ACCOUNT_ID=your_sandbox_organization_id
BILLING_PRODUCTS={"pro-monthly":{"label":"Pro monthly","kind":"subscription","dodo":"dodo_product_id","polar":"polar_product_id"},"lifetime":{"label":"Lifetime","kind":"one_time","dodo":"dodo_other_product_id","polar":"polar_other_product_id"}}
```

Only configure account IDs for providers you actually use. Each slug is stable,
unique and server-allowlisted; each provider product ID maps to only one slug.
Use `subscription` for recurring products and `one_time` for independent purchases.
Browser callers send slugs, never prices, provider IDs or customer IDs.
A blank default disables new sales while retaining configured historical providers.
Do not rename historical slugs or replace accounts without a reviewed migration.

## 2. Private credentials

Use `~/.alchemy/profiles/default/billing.json` for local/cloud dev and
`~/.alchemy/profiles/prod/billing.json` for production. `ALCHEMY_HOME` overrides
that home. Keep files owner-only (`chmod 600`) and outside the repository.
Example structure, with placeholders only:

```json
{
  "format": "alchemy.profile/v1",
  "provider": "Billing",
  "values": {
    "dodo": {
      "mode": "test",
      "accountId": "your_test_business_id",
      "apiKey": "your_test_api_key",
      "webhookSecret": "your_test_signing_secret"
    },
    "polar": {
      "mode": "test",
      "accountId": "your_sandbox_organization_id",
      "apiKey": "your_sandbox_access_token",
      "webhookSecret": "your_sandbox_signing_secret"
    }
  }
}
```

Omit unused providers. Production uses `mode: "live"`, matching production IDs
and credentials, never copied dev secrets. Launchers check mode/account matches,
clear inherited billing credentials and bind keys only as server-side redacted
Worker Config secrets. API keys and signing secrets never belong in stage env files.
For Polar, grant the token only the customer, checkout, portal, order/refund and
subscription read/write permissions needed by the adapter.

## 3. Webhooks and deployment

Register these endpoints with all subscription/payment/order/refund/dispute events
supported by the chosen provider, and put each signing secret in its profile:

- Dodo: `https://your-app.example/api/billing/webhooks/dodo`
- Polar: `https://your-app.example/api/billing/webhooks/polar`

Signature verification is mandatory; never skip it for test callbacks. A browser
checkout return does not prove payment. Provider resources are retrieved with the
configured account credentials before ownership/access records are committed.
Production has no developer Access wall, but application APIs still require auth.
Cloud dev remains Access-gated, including webhooks; this change adds no bypass.
For local testing, use an explicitly approved, path-restricted test-only tunnel to
localhost:1337. Do not expose the whole private application or production credentials.
Any cloud-dev callback exception needs a separately approved isolation plan.

Run `pnpm lint` and `pnpm build`, inspect `pnpm plan:dev` / `pnpm plan:prod`, and
obtain deployment approval before applying a cloud change. Existing additive auth
migrations create the billing tables/indexes; no reset or destructive migration is
required. Interrupted migrations must be rerun and reviewed, not bypassed.
Local `pnpm dev` reads only billing configuration from `.env.dev`, forces test mode
and uses local D1. It is still possible for test SDK calls to reach provider APIs.

## 4. Account and recovery

Account settings shows products, provider-scoped portals, statuses, refunds and
stale records. Buying creates a durable request ID reused for retries. Unknown
checkout outcomes require operator reconciliation, not another blind charge attempt.
Additional subscription checkout is blocked while a known subscription is
nonterminal or any subscription intent remains unresolved. Unresolved one-time
intents also block the same user's product slug, including after a tab is closed.
Time does not release an unknown attempt; verified resource reconciliation does. Use the portal
for provider-supported cancellation or changes. Deliberate one-time repurchases
must use a fresh request ID after resolving the previous attempt. Browser-session
request/receipt IDs survive reload/return; only correlated confirmed records clear
them. If a provider omits checkout IDs, automatic client cleanup cannot complete.

Owner refresh (`POST /api/billing/refresh`, `{ "key": "record-key" }`) retrieves
current state for a known record. Admin-only endpoints are:

- `GET /api/admin/billing/events`: up to 100 incomplete/failed event references.
- `POST /api/admin/billing/replay`, `{ "key": "event-key" }`: retry authoritative sync.
- `POST /api/admin/billing/refresh`, `{ "key": "record-key" }`: repair known facts.

Mutations require a real application session plus an exact same-origin Origin
header; admin routes also require the existing admin role. Event responses contain
only safe error categories. No operator UI, provider-wide import or periodic scan
is installed. A first purchase with no delivered event requires manual provider
reconciliation; known-resource refresh cannot discover unknown resources. Unresolved
Dodo customer intents, Polar customer intents older than 23 hours and ambiguous
checkout sessions are fail-closed. Resolve
those using verified provider IDs and a separately reviewed database operation;
there is deliberately no endpoint that lets a client attach arbitrary customers.
The pinned Polar export has no dispute webhooks: dispute holds/recovery are checked
when purchase facts are refreshed, not immediately on dispute creation. Individual
Polar disputes are not automatically imported. Dodo subscriptions expose no checkout
ID; original associations use server correlation or a saved linked payment, and
uncorrelated historical intents remain retryable rather than receiving a new slug.

## 5. Extending fulfillment

Configure `BillingHooks.layer` in `apps/api/src/billing-hooks.ts` with an optional
`afterSync` Effect. It receives sanitized snapshots, original event type, scope and
an event key. Billing facts commit before this hook; inbox completion waits for
success. Failed hooks can be replayed. External shipping, license or credit actions
must implement their own durable financial-object/action idempotency and tolerate
ambiguous timeouts and expired workers. Event IDs alone cannot deduplicate a renewal
payment and subscription activation. A refresh repairs facts but does not fulfill.
Adjust `billingAccess` in `apps/api/src/billing-records.ts` for application policy;
the default is conservative and rejects snapshots older than 24 hours.

## 6. GitHub and acceptance

In the production GitHub environment, add nonsecret variables `BILLING_PROVIDER`,
`BILLING_PRODUCTS`, `DODO_ACCOUNT_ID`, `POLAR_ACCOUNT_ID`, and secret
`BILLING_PROFILE_JSON` containing the production-only profile above. PR/build jobs
receive none of these credentials. See [CI/CD](github-cicd.md).

Before launch, the application owner must exercise both providers/product kinds:
checkout, delayed/no return, owned portal, duplicate/reordered events, storage and
lease failures, renewal/holds/cancellation, successful/failed/partial/full refunds,
disputes where supported, stale refresh, failed-hook replay and default-provider switching. Inspect
logs for secrets and raw payloads. Offline type/build checks do not verify provider
runtime compatibility, actual D1 transaction behavior or the live payment lifecycle.
