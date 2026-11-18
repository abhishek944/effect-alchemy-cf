# Dependency audit exceptions

The local pre-commit and pre-push hooks do not run `pnpm audit`; they gate on frozen
install, lint and build. CI's `Check` job runs a labeled dependency audit step with
`continue-on-error: true`, so advisories stay visible in the log without failing the
job. One advisory is currently and deliberately excepted, in `pnpm-workspace.yaml`:

```yaml
auditConfig:
  ignoreGhsas:
    - GHSA-fc5q-39xc-vjpf
```

That setting is resolved by pnpm 10.33.4 (the pinned package manager) from
`pnpm-workspace.yaml`, so the CI audit step honors these exceptions. The filter
matches the exact GitHub advisory ID, not a package or a severity: any other
advisory — including a later picomatch advisory — still appears in the audit output.

## The excepted advisory

`GHSA-fc5q-39xc-vjpf` (high, CVE-2026-112366): picomatch ReDoS through single-branch
repeated extglobs. It reaches this repository only as build tooling:

- `apps/web > @vitejs/plugin-react > @rolldown/plugin-babel > picomatch`
- `tinyglobby > picomatch`

Both paths are development/build dependencies. Nothing is sent to a browser bundle
from picomatch, and no runtime server process evaluates glob patterns with it.

## Why it cannot be fixed yet

- No patched release exists. The advisory lists `patched: <0.0.0`, and the registry's
  latest picomatch is still `4.0.7`, the last vulnerable version.
- It is not removable by dropping an unused optional peer: `tinyglobby` declares
  picomatch as a direct dependency, and the Vite React plugin needs its Babel peer.
- Forcing another version with `pnpm.overrides` would not help, because no safe
  version exists to force.

## What is deliberately not excepted

`undici` 8.10.2 and `minimatch` 10.2.6 are exact pins inside
`@earendil-works/pi-coding-agent` 1.2.0. They are **not** excepted, so the CI audit
step keeps reporting them. Clearing them requires the deferred Pi 1.5.x family
upgrade plus the `apps/api` schema migration, not an exception.

## Removal procedure

When a fixed picomatch release is published:

1. Update the dependents that pull it (`pnpm update --depth Infinity picomatch` or
   the direct dependency pins that resolve it) and install the result.
2. Remove only the `- GHSA-fc5q-39xc-vjpf` entry from `auditConfig.ignoreGhsas` in
   `pnpm-workspace.yaml`. Keep the block and any other exception entries in place;
   delete the block only if removing this entry leaves it empty.
3. Run `pnpm audit` with this exception absent, and confirm the advisory is gone
   because the dependency changed. An audit run while the entry is still present
   cannot show remediation, since the filter hides the advisory.
4. Run `pnpm install --frozen-lockfile`, `pnpm lint` and `pnpm build`, then remove
   this document's exception section.
5. Do not keep the entry "to be safe": it hides future regressions in the same path.
