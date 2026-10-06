# Service starter

- Use pnpm; pin direct dependency versions and keep the lockfile.
- Run `pnpm lint` and `pnpm build` before handing off changes.
- Every authored text file must be <=200 physical lines, including blanks/comments.
  Generated lockfiles, dependencies, build output, and `var/` are excluded.
- Keep auth/database adapters in `packages/auth`; API handlers in `apps/api`;
  frontend in `apps/web`; stack composition in `apps/infra`.
- Never import infrastructure, provider clients, or secrets into browser code.
- Stage env files live in `packages/config/.env.dev` and `.env.prod`, stay
  gitignored, and must have identical keys. Provider credentials stay in profiles.
- Prefer Effect services and schema-defined boundaries over custom abstractions.
- Cloud development uses the `dev` stage, isolated from `prod` and gated by
  Cloudflare Access. Do not reference production resources from development.
- Read plans before deploying. Do not deploy, destroy, adopt, or commit without approval.
- GitHub deploys only prod pushes after checks; production secrets stay in the
  production GitHub environment. Keep PR checks unprivileged; see docs/github-cicd.md.
- No unit tests unless the latest user request explicitly asks for them.
- Do not add optional services until an application actually needs them.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
