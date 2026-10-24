# Billing: low-level design

## Scope

Optional Dodo and Polar billing supports hosted checkout, a customer portal,
subscriptions and one-time digital purchases. Stripe is excluded. Better Auth
supplies identity, not payment-provider endpoints. The application owns its
billing schema and translates provider state without discarding original status.
This document is the implementation contract; runtime/live verification is separate.

## Boundaries

- `packages/integrations`: schema-defined billing contract and official SDK adapters.
- `packages/auth`: schema-only plugin, additive migrations and D1 persistence.
- `apps/api`: configuration, authenticated orchestration/endpoints and webhooks.
- `apps/infra`: existing Worker composition; no separate public billing service.
- `apps/web`: account billing panel using only same-origin JSON APIs.

The common provider interface has customer creation, checkout creation, portal
creation, verified-event decoding, and authoritative resource retrieval. Adapter
errors are sanitized. Provider URLs, signatures, and resource models stay private.
Only stable product slugs and normalized records cross the browser boundary.

## Configuration and isolation

`BILLING_PROVIDER` is blank, `dodo`, or `polar`. Blank disables new sales.
`BILLING_PRODUCTS` is JSON mapping stable slugs to a label, kind (`subscription`
or `one_time`), and per-provider product IDs. IDs are nonsecret configuration.
Each enabled provider requires an explicit account ID, API key and webhook secret.
A provider can remain enabled for historical subscriptions while another is default.
Non-production execution forces Dodo test mode and Polar sandbox. Production uses
live mode. Account and environment form a persisted scope; IDs/events are unique
inside that scope. Changing account configuration never rewrites historical rows.
Credentials live in a private Billing provider profile and become redacted Worker
Config bindings. Production CI may supply a production-environment-only profile
secret; PR checks never receive it. Never add credentials to stage env files.
Offline builds need no credentials. Customer external IDs include app/stage identity.
Initially one account per provider/stage is supported. Same-provider account
replacement needs a separate migration; missing original scopes always fail closed.

Cloud development remains behind Access. Do not silently exempt webhooks from
that wall. Use a localhost tunnel with test credentials for provider callbacks;
cloud development callbacks need separately approved Access/network configuration.
Production webhooks require a signature, not an application session.

## Persistence

The existing stage-isolated auth D1 owns the following application tables. A
schema-only Better Auth plugin includes these definitions in the existing reviewed
additive migration Action; auth-provider billing plugins are not installed.

| Table              | Key fields and relationships                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `billing_customer` | Deterministic scope/user key, user ID, scope, provider customer ID                                     |
| `billing_checkout` | Unique user/request key, immutable scope/slug/kind/product/customer command, session ID, URL and state |
| `billing_resource` | Scope/kind/provider ID; user ID, customer ID, product ID, status and normalized snapshot               |
| `billing_event`    | Scope/event ID; type, minimal resource reference, state, attempts and safe error category              |
| `billing_lock`     | Scope key, lease token, admission token and database-time expiry                                       |

Resource kind is `subscription`, `purchase`, `refund`, or `dispute`. Purchases
retain optional subscription IDs and product lines. Refunds/disputes retain their
purchase ID. This compact shared resource table avoids six nearly identical
snapshot tables while preserving relationships in typed boundaries. No auth
credentials, raw request bodies, billing addresses or payment-method data are
stored. Amounts remain integer minor units with currency. Financial records must
not cascade-delete with users; user deletion/retention is a product policy.
Customer mappings are unique by scope/user and scope/provider customer ID.
Composite indexes and nullable fields are defined in the schema plugin. Better
Auth forbids nullable unique-index columns, so private required provider/session
keys use unique intent sentinels until resolved, then equal the real provider ID.
User IDs are verified logical links, with no cascading auth foreign keys. Auth user
deletion remains unavailable. Validate generated SQL: additive migrations execute
statements individually; rerun after interruption, and separately review existing
constraint changes. Historical resource lines retain their original slug/kind.

## API

Authenticated endpoints:

- `GET /api/billing`: configuration, product choices, owned customer scopes and records.
- `POST /api/billing/checkout`: slug and a browser-generated request ID.
- `POST /api/billing/portal`: an owned customer scope, never an arbitrary customer ID.
- `POST /api/billing/refresh`: owner-filtered known-resource reconciliation.
- Admin-only event listing/replay and known-resource refresh.

Mutations require an exact same-origin Origin header and bounded bodies. Provider
product IDs, user IDs, metadata and redirect destinations are selected server-side.
Checkout return is the account billing page and grants nothing based on its query.
Read responses are non-cacheable and owner-filtered. Billing errors are generic;
provider bodies, keys and personal data are not logged or returned. Storage,
decode and SDK failures keep their existing `BillingError` kind and attach the
original failure only as a non-enumerable in-memory cause; the HTTP group and
webhook ingress report it once with fixed labels, then encode the same status.
Lease release and failed-event bookkeeping report separately and never change a
known checkout outcome or authorize a retry.

## Checkout and customers

Resolve the signed-in user and configured allowlisted product. Resolve/create a
customer with a stable server-generated external/idempotency identity and persist
the customer mapping before checkout. Dodo uses explicit customer ID; Polar uses
external ID/customer ID rather than email matching. Persist the checkout attempt
before the SDK call. Lookup user/request ID before selecting today's default;
reject changed slugs/payloads. Reserve customer intent before external creation.
Customer/checkout mutations share the scope lease and immutable command identity.
Pending/unknown outcomes are not blindly retried: use only verified provider
idempotency or lookup recovery; otherwise require operator resolution. SDK retries
are disabled and deadlines bounded. Correlate sessions with server-owned metadata.
Distinct paid objects remain distinct financial facts, not duplicate events; no
consumable credits are granted. Block additional subscription checkout while a nonterminal subscription or an
unresolved subscription intent exists. A unique user-scoped intent guard and a
transaction-time subscription check cover concurrent provider switching; only
verified subscription reconciliation releases the intent, never elapsed time. Deliberate one-time repurchases use new request IDs.

## Webhook state machine

1. Accept only POST on an exact configured-provider webhook path. Bound raw bytes
   before parsing and verify the raw body with the official SDK.
2. Verify the provider account identity where present. Extract event ID/type and
   minimal resource references. Unknown signed events are acknowledged without
   business side effects; malformed/invalid signatures are rejected.
3. Persist an inbox row with a scoped unique key. A completed duplicate gets 200;
   an incomplete duplicate remains retryable.
4. Acquire a short D1 scope lease with a random fencing token. For this starter,
   provider-scope synchronization is serialized; high-throughput consumers can
   replace this ceiling with resource/customer-scoped queues without changing APIs.
5. Retrieve current provider resource state after acquiring the lease; hydrate
   parent purchases for refunds/disputes. Never order state solely by webhook time.
6. Resolve ownership from persisted customer mapping, not unsigned/client metadata.
   Unmapped customers remain failed and visible for admin recovery, not fulfilled.
7. Begin one D1 batch with admission: set `admittedToken` to a fresh random nonce
   for this batch only when the lease is valid using database time and the inbox
   still belongs to this processing token. This event-state admission gates every
   snapshot and completion write, not merely a post-commit row-count check. Every subsequent
   insert/update checks lease token plus this nonce, never reusing prior admission
   or evaluating a separately advancing clock. D1 serializes this
   transaction-wide decision. Upsert snapshots, complete the inbox, and release
   conditionally. Confirm completion affected exactly one row before returning 2xx.
   Expired workers cannot admit, overwrite newer state, or mark another event failed.
8. Return 2xx only after durable success. Provider, storage and busy errors return
   a retryable response. Finite provider retries are supplemented by admin replay.

There is no fire-and-forget fulfillment or reliance on in-memory duplicate sets.
Processing time is bounded; slow operations remain retryable. Admin replay uses
stored references and fresh provider state, not previously trusted raw payloads.

## Defaults and customization

Subscriptions expose provider status, period end, cancellation flag and an access
view: active/trialing grant access; scheduled cancellation preserves the paid
period; terminal states revoke it. Holds/past-due/paused states are conservative
unless a consumer explicitly adds a grace policy. A successful one-time purchase
exposes its product entitlement; failed/pending purchases do not. A full successful
refund removes the purchase entitlement; partial refunds remain visible and do not
silently revoke the entire purchase. Disputed purchases are flagged conservatively.
Persisted slug/kind associations do not change when the sales catalog changes.
Subscription-linked purchases never create independent lifetime grants. Snapshots
older than 24 hours are stale and do not authorize access; subscription access is
also bounded by its period end. Owned/admin refresh fetches current provider state
for known resources, repairing events that never reached the inbox.
These are billing facts, not chat credits, shipping, license generation or external
workspace provisioning. `apps/api/src/billing-hooks.ts` exposes an optional Effect `afterSync` hook.
Without a hook, snapshots and inbox completion remain one atomic fenced batch.
With a hook, snapshots commit first; the inbox remains incomplete until the hook
succeeds and a separate, freshly fenced batch marks completion. Failures are
replayable. Hook actions must tolerate retries, expired workers and ambiguous
external outcomes: use provider-scoped financial object/action IDs for durable
idempotency, not just event IDs. No distributed exactly-once guarantee is implied.
Known-resource refresh repairs facts but does not invoke fulfillment; operators
replay failed inbox events for hooks. Consumers own policy and external idempotency.
Renewals and subscription activation must not count as two independent grants.

## Switching

Changing the default provider changes only new checkout. Portal and records route
by their original scope. Keep old credentials/webhooks configured while old
subscriptions run. Moving subscriptions or payment methods is a separate migration.
Provider-native benefits, metering, proration and seats are not generalized here.

## Verification and rollout

Review the schema plan before any deployment. Verify local schema/index metadata,
no-secret offline build, lint and type checks. Provider-live acceptance is user-owned:
checkout and delayed returns for both product kinds/providers; portal ownership;
duplicate/reordered delivery; expired leases and storage failures; renewal, holds,
cancellation and recovery; full/partial refunds; unknown/unmapped events; admin replay.
Confirm dev/prod isolation and that logs contain no keys or raw billing payloads.
Rollback disables new checkout but retains historical webhooks and database rows.
