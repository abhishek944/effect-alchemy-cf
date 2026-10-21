# Native Office images and finite jobs

This is the Node/SDK/renderer artifact and finite native job composition, not a
new web app. The historical foundation target remains separate: no model command,
actor credential or app wire type is accepted by its fixed smoke entry.

## Prepare and build

After the parent-owned install/lockfile has completed, run from the repository:

```sh
node --experimental-strip-types apps/office/src/build-foundation.ts
docker --host unix:///var/run/docker.sock build --platform linux/amd64 \
  --provenance=false --tag office-native-foundation:local \
  var/office/runtime-image-details/context
```

Preparation uses the declared Vite API. It bundles private workspace TypeScript
into `node/*.mjs` and emits the actual public SDK Render Page. SDK/native packages
remain external and are installed only during the explicit image build from
copied dependency declarations and the frozen root lock. Dependency lifecycle
scripts are disabled. No checkout, environment file, home, registry configuration
or Darwin node_modules directory is copied into the image.

`image-profile.json` pins the official Node Linux/amd64 manifest, tool/SDK cohort,
Debian browser/font versions and public RaTeX WASM/font archive integrity. The
archive supplies binary/font data omitted from the SDK's published LaTeX bundle;
no vendor JavaScript implementation is imported from an internal path or patched.
`image-provenance.mjs` checks versions, native x86-64 ELF bindings and hashes the
browser/fonts/native artifacts. The completed local image ID is a separate host
acceptance record; select that immutable ID, never the mutable tag, for a job.

The image entrypoint runs real native Sheet/Doc/Slide initialization and PNG
capture. It is a fixed artifact smoke, not the application CLI dispatch. Invoke it
only through `@starter/office-server/executor`, with a finite image profile and
empty stdin. Its output contains synthetic native PNG bytes for artifact review.
The verified runner must return exited/0 and confirmed cleanup before the smoke
output can be interpreted. No output claims an application commit.

## Runtime exports and boundaries

`@starter/office-server/jobs` exports `OFFICE_NATIVE_TYPES`,
`createOfficeHeadless`, `createOfficeRuntimeFactory` and `createOfficeRenderer`.
These compose public SDK services and retain their native types; they are not a
sandbox. The caller owns close/dispose, backend authority and the outer boundary.
`@starter/office-server/render-page` exports `mountOfficeRenderPage` for the
standalone browser entry. The Node artifact also exports the bundled factory
module as `runtime-foundation.mjs`, without private source-exported TypeScript.

No runtime downloads are allowed. Chromium uses the SDK's `--no-sandbox` behavior,
so network-none, nonroot, readonly, cap/seccomp/resource-constrained outer
isolation is required even for probes. Empty runtime license preserves the
vendor's unlicensed/watermarked behavior; no license is copied or hidden from
code in its process. The historical foundation image/evidence is not acceptance
of the separate finite job target below.

## Finite isolated jobs

`Dockerfile.jobs` builds separate `worker` and clean `acceptance` targets. Do not
retag or rebuild the historical foundation to run native jobs.

```sh
node --experimental-strip-types apps/office/src/build-jobs.ts
docker --host unix:///var/run/docker.sock build --platform linux/amd64 \
  --provenance=false --target worker --tag office-native-jobs:local \
  var/office/jobs-details/context
docker --host unix:///var/run/docker.sock build --platform linux/amd64 \
  --provenance=false --target acceptance --tag office-native-job-acceptance:local \
  var/office/jobs-details/context
node --experimental-strip-types apps/office/src/verify-jobs.ts owned-check
node --experimental-strip-types apps/office/src/verify-hostile.ts owned-check
node --experimental-strip-types apps/office/src/verify-job-isolation.ts owned-check
```

The optional bounded probe directory name selects an owned output subdirectory
and distinct Docker owner labels. Use a different name for an independent rerun;
these are verification options, not production job parameters. The actual image
IDs and raw inspection/candidate/native/PNG/export artifacts are retained there.
The clean seed artifact includes the image's build provenance.

`makeIsolatedJobs` accepts only the existing finite import, execute, inspect,
render and export jobs. It streams immutable owner-scoped references through
Node, validates exact bindings/digests and durably reserves before claiming.
Only an acknowledged queued-to-running CAS winner can launch. Unclaimed
capacity returns retryable `BUSY`; there is no hidden queue driver. Status never
executes source. Unknown/terminal jobs cannot be reclaimed or replayed, and
acknowledged absolute deadlines include input preparation and actual teardown.

Every generated program runs in a fresh credential-free, no-egress placement
through the unchanged hardened executor. Output remains an untrusted bounded
candidate. `validateMutationCandidate` uses a separate clean SDK and host-supplied
identity to validate/replay before returning a proposal, never an SDK submit.
The initial mutation profile permits Sheet scalar/formula writes, Doc body edits
and Slide shape-text subtrees; other mutation families are rejected explicitly.
Production placement must prove the same real outer isolation, not wrap a warm
credential-bearing process or privileged nested Docker.

## Injected application compositions

`runOfficeCommand(resolve, raw)` is the existing finite seventeen-command
dispatcher. `runOfficeCli(resolve)` supplies bounded stdin/stdout transport.
The trusted resolver supplies fresh task/OfficeService resources and the exact
invocation's immutable accepted-file proof; model paths, URLs and ambient
credentials are not attachment authority.

`createOfficeJobHost(options)` returns `jobs` and a metadata-only private request
handler with injected authorization. These are exported injected compositions,
not an already authenticated standalone server or application CLI. T22 supplies
trusted scoped resources. `@starter/office-runtime/host` now exports
`createOfficeReadonlyHost` for a private Node listener using the public SDK and the
real readonly Doc adapter. It admits only positive-revision main Doc snapshot GETs,
with explicit target/IP/port/concurrency/deadline and a required genuine delegated
resolver. It owns revoke-first request/socket/SDK cleanup; it does not supply that
resolver, mount a SaaS host or enable writes/tickets/WSS. Source/static checks are
not listener, authentication or runtime acceptance.

The application composes genuine Worker/session/View/task issuance, finite storage
callbacks, native-bootstrap and fixed fresh-job roles from ONE application image.
Use the `application` target in Dockerfile.jobs, not a historical smoke image.
For ordinary local operation, start Docker and run `pnpm dev`: the launcher builds
this target and binds its actual immutable local Docker image ID automatically.
No application-image publication or Cloudflare deployment is needed locally.
Cloud deployments remain separate approved operations requiring a registry digest.
See [Office setup](../../docs/office.md) for original-file/Send/editor boundaries.
Source integration and image build alone do not prove native runtime acceptance.
