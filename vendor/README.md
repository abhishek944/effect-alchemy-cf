# Pinned local SDK packages

`abhishek944-pi-langfuse-0.1.0.tgz` is an npm-packed, MIT-licensed source distribution
from `abhishek944/astack`, package directory `packages/pi-langfuse`. It is unpublished,
not a registry release, installed global package, absolute machine dependency or app
fork. The tarball is part of this repository and pnpm's frozen lockfile records its
integrity; another checkout does not need the developer's Astack directory.

- Source repository context: `d16bb3233aceb69436f37a976f9c849f0816853a`.
- The package itself was untracked/uncommitted at packing time; that commit does
  **not** identify its package contents. The tarball hash is the exact identity.
- SHA-256: `1c43a1119866df5e29eb6d3eb1e36d49fa6a7576bf22b468e815e05189dde51f`.
- SHA-512 integrity is recorded in `pnpm-lock.yaml`.
- Built with the package's existing TypeScript build and `npm pack`; no publication.
- Native session observation remains unchanged. The minimal supported standalone
  Pi-AI metadata-only generation seam is documented in packaged `STANDALONE.md`.
- Package runtime dependencies are exact Langfuse `6.1.1`, OTel API `1.9.1`, and
  trace base `2.12.1`; Highchat uses coordinated Pi `1.2.0` with its lockfile.

To update intentionally, review the source/package changes, run its lint, typecheck,
build and pack checks, retain license and documentation, replace the artifact, update
this hash and pnpm lockfile, then run Highchat lint/build. Never edit installed files
or silently replace this artifact without updating provenance/integrity.

## Classifier 0.4.1

`abhishek944-pi-classifier-0.4.1.tgz` is the Apache-2.0-licensed existing package
from the same Astack repository, `packages/pi-classifier`. This version is not
published to npm. It was packed with `npm pack --ignore-scripts`, without changing
its source, manifest or emitted dist; no fork or absolute runtime dependency.
Its tracked source was clean at source context commit
`d16bb3233aceb69436f37a976f9c849f0816853a`; the tarball hash identifies the
exact source plus existing compiled artifact, independently of that commit.
SHA-256: `a757fe93a544f1e574cc013be5df9d2b62d2534912c8a6b709694904cae0fe75`.
The pnpm lockfile records SHA-512 integrity. Public root `classify` is used with
explicit per-call settings; desktop/Durable extensions and global discovery do
not load. Its required coding-agent >=1.2.0 peer is satisfied by the exact 1.2.0
API/host family. Caret-ranged internal Pi packages are constrained to 1.2.0, not
silently upgraded to a later family. The existing Langfuse artifact is unchanged.

Runtime credentials/projects, actual export delivery and paid inference remain
operator-owned prerequisites; a packed import/typecheck is not live integration proof.
