# Office storage bindings

The existing stack declares logical `OfficeDatabase` (D1) and `OfficeData` (R2)
resources and supplies their exact references to `ApiWorker` through `OfficeStorage`.
The existing non-runtime `workerOptions` binds them as `OFFICE_D1` and `OFFICE_R2`.
This follows the ChatFiles injection pattern; it is not a new storage/auth protocol.

No physical name is hard-coded. Alchemy derives names from the existing stack,
stage and logical resource IDs. Existing local/cloud/prod guards remain unchanged.
Do not rename these persistent identities after deployment without reviewing
replacement/deletion and a data-preserving migration plan.

Office storage is separate from the existing `AuthDatabase` and `ChatFiles`.
AuthLive/signing configuration, Access, chat storage and custom Worker source/assets
remain unchanged. No second login, credentials or new dotenv keys are introduced.
Browser code must never import this server-only resource module.

`OfficeData` has no public access, custom domain, CORS or lifecycle expiry rules.
`forceDestroy:false` does not empty a nonempty bucket during ordinary removal; it
is not a universal deletion guarantee. No unsupported D1 deletion-protection flag
is invented. Review every persistent-resource deletion/replacement before applying.

## What is and is not implemented

These are real declarations in the existing stack and API binding graph, not an
in-memory provider or substitute for native D1/R2. No alternate Office database,
bucket fallback, manual shared production name or authoritative cache is added.
The existing `serviceName` and stage selection are unchanged.

This source change does **not** initialize schemas, run migrations/imports/clones,
reset/adopt data, register a document DO/container, mount an Office HTTP route,
start the Node host or implement the original session/View/placement/cohort issuer.
Those next steps must consume these exact native bindings with the same trusted
Auth graph and preserve original request/event/response-body authority.

Only source/static verification is performed in this increment. No resource was
created or modified, plan/deployment run, provider contacted or SDK/listener started.
Actual binding materialization, stage isolation, retention and application behavior
still need separately authorized local/cloud acceptance. Historical Office native,
foundation and job evidence is not evidence that this new graph was applied.
