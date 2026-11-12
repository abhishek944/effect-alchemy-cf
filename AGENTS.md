# highchat

- Use pnpm; pin direct dependency versions and keep the lockfile.
- Run `pnpm lint` and `pnpm build` before handing off changes.
- Every authored text file must be <=200 physical lines, including blanks/comments.
  Generated lockfiles, dependencies, build output, and `var/` are excluded.
- Keep identity adapters in `packages/auth`; API handlers in `apps/api`; frontend in
  `apps/web`; runtime adapters (SQLite, object storage, runtime env, HTTP boundary)
  in `packages/platform`.
- Never import provider clients or secrets into browser code.
- Stage configuration is injected by `doppler run` from project
  `effect-boilerplate` (config `dev` or `prd`); the repository keeps no stage env
  files. Public browser values are limited to app branding and `pk_`
  publishable keys; provider credentials remain process environment values.
- Prefer Effect services and schema-defined boundaries over custom abstractions.
- The runtime is one local Node process plus the private Pi host. There is no
  edge runtime, infrastructure-as-code provider, deployment configuration or cloud
  infrastructure. The only cloud configuration dependency named by the repository
  is the Doppler project `effect-boilerplate` used to inject stage values.
- Read plans before deploying. Do not deploy, destroy, adopt, or commit without approval.
- CI runs frozen install, audit, lint and build only; it holds no cloud credential.
  See docs/github-cicd.md and docs/runtime.md.
- No unit tests unless the latest user request explicitly asks for them.
- Do not add optional services until an application actually needs them.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
