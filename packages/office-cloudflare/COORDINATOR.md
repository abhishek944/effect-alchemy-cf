# Trusted Office placement and turn control

`@starter/office-cloudflare/coordinator-control` exposes the existing same-Office-D1
persistence facade directly, not a new coordinator framework or HTTP service:

- `createCoordinatorControl(options, verifiedContext)` returns `CoordinatorControl`.
- `initializeCoordinatorSchema(database)` and `coordinatorSchemaVersion` retain
  their existing schema lifecycle; exposing them does not initialize a database.
- `CoordinatorControl` and `VerifiedCoordinatorContext` are exported types.

The implemented methods are `placement`, `place`, `acquireCore` and `changeTurn`.
They retain their existing typed Store/effect failure contract. There are no
placeholder broker, resource, transport, editor or authentication implementations.
This private package is not another application or public cross-repository SDK.

## Trusted caller responsibilities

The intended next caller is the owning document DO issuer, which is not yet wired.
It must supply actual `OfficeProviderOptions` and a context derived **after** real
session/View/operation authorization. `VerifiedCoordinatorContext` decoding,
`authorizationDigest`, target IDs and the public package entry are not credentials.
Never construct trusted context from browser/Node JSON or arbitrary headers.

`placement(document)` checks captured identity and stored head/placement consistency;
it can still return retired or expired placement. The issuer must check live state,
deadline, authority/service epochs and actual process/incarnation/cohort against
the active View. Native epoch fencing alone does not prove those other identities.
Keep View-bound access; owner-main lookup is not an authorization fallback.

The existing `read` context variant carries the actual target and View ID. It does
not require an invented principal/sessionEpoch. `place` requires the separately
verified placement context. Claim changes epochs and may invalidate old Views;
do not claim during readonly ingress as a substitute for authorization. Establish
actual process ownership separately before creating its corresponding View.

Schema setup, same Office D1/R2 composition, stage/worker identity and disposal
remain host-owned. Auth uses the existing separate AuthDatabase/configuration;
this entry does not introduce another identity database, signing secret or login.

## Scope and acceptance

This export adds no SQL, schema change, dependency, wrapper or authorization policy.
Existing native, metadata and control implementations are unchanged. It is not a
mounted host, genuine delegate issuer, private channel or successful placement.
Current source/static checks do not establish runtime/authentication, container
reachability, callback progress, publication, restart/abort behavior or SaaS flows.
