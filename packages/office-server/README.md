# Office server

Server-only Effect services over pinned public Univer SDK **1.0.3**.
Never import Node SDK/Core entries into browser or Cloudflare Worker code.
Workers may use portable `./ports`, the Worker-safe `./native-remote` wire entry,
and the separate portable contract package. Browser code uses contracts only.

## Construction

`makeOffice(deps)` is scoped and returns the complete `OfficeService`. Keep its
scope alive while serving requests; closing it disposes SDK caches, not documents.
The caller owns the injected providers. There are no default auth/storage/job
providers or in-memory authoritative fallbacks.

Required dependencies: actual `native`, `observeNativeReceipt`, `metadata`,
`bytes`, `authority`, `jobs`, `verifyActor`, and a validated pinned `policy`.
Use the real `makeIsolatedJobs` exported by `./jobs` for isolated work; construction
requires its actual metadata/bytes/placement/policy/worker dependencies.

A host sharing SDK resources with native endpoints may acquire
`makeNativeRuntime(deps)` and call `composeOffice(deps, runtime)` instead.
`runtime.services(target)` pins cached SDK services for endpoint lifetime; it
**does not grant data access**. Every real SDK callback still needs a fresh
`runtime.invoke(...)` scope and actual admitted adapters. Nested Worktree/trunk
calls reuse that invocation's pair. Never retain a native write permit.

## Readonly main Doc adapter

`./native-doc-read` exports `createReadonlyDocDatabase` and `DocReadOptions` for
one explicit main Doc scope. It requires actual private fetch/association/access,
expiry/abort and finite budgets; all writes and Sheet blocks are denied.
Node loads published native frames through bounded refs/pieces. This is not an
installed host, authentication provider, writer or Worktree implementation.

## Native HTTP/WebSocket boundary

`./native-protocol` composes the actual SDK endpoints/transport with finite routes.
`createOfficeProtocol(services, authority, views, submissions)` requires the fourth
`OfficeSubmissionAuthority` argument, alongside `OfficeProtocolAuthority` and
`OfficeViewProtocol`; none has a permissive default. Its main/draft callbacks
preserve actual SDK submit results and enter a genuine editor-scoped invocation
before fresh SDK work. `NativeEditorPermit` is identity, not a credential or fake
business operation. The real handler must verify joined session/current editor
and supply admission/journaling; this boundary alone proves neither saves nor auth.
Fresh host identity, Origin/channel/session, lifecycle/generation/epoch and final
D1 publication fencing remain required. Live and pinned View snapshot/authz/image
requests are View-bound. Pinned data comes from exact immutable sources, never a
fabricated live main or Unit alias.

An artifact View's revision is its verified immutable native header, not proof
that the version was published on its target branch. Ordinary artifact download
policy still applies. Native image IDs need durable document association; an
owner-scoped byte lookup alone is not that proof.

## Operation safety

Original actor/intent/input/code/job/cohort identities are immutable. Explicit
same-ID submit can retry an unclaimed BUSY job; status does not dispatch code.
Accepted or uncertain source is never replayed/rebased after human edits.
Native leaves are journaled as binary artifacts before publication, with the
provider's original preparation fingerprint/epoch. Missing evidence stays unknown.
Cancellation prevents not-yet-admitted native publication; it does not assert that
isolated code never ran and never rolls back accepted writes.

Reviews preserve all native comparison items in a private immutable bundle;
public pages are separately bounded. Frozen role IDs stay stable. Expired reviews
or role Views fail `STALE_REVIEW`; readers do not mint/renew them. Native removal
review/approval is not exposed. Only a freshly verified human can approve/merge.

Constructor/type/build success is separate from real authority/native/host
acceptance. Concrete broker/DO, HTTP/WSS/image and concurrent/restart workflows
must be exercised together before treating the integration as operational.
