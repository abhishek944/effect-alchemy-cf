# Effect + Alchemy Cloudflare starter

A small reusable service template. **Development deploys to the real Cloudflare
`dev` stage**, isolated from `prod`. Installing, linting, or building does not deploy.
GitHub checks main/PRs and automatically deploys prod pushes through Alchemy.
See [CI/CD setup](docs/github-cicd.md) for required secrets and branch protection.
[Backend observability](docs/observability.md) covers native metrics, traces and safe logs.

## Stack

- pnpm + Turborepo, strict TypeScript 7.
- Effect 4 HTTP API with schema-defined responses and session middleware.
- Alchemy 2 beta owns the Worker, isolated D1 database, auth signing secret,
  additive auth migrations, and Cloudflare Access application.
- Better Auth email/password sign-up, sign-in, sessions, and sign-out.
- React + Vite + Tailwind 4, editable shadcn Button/Input/Card components.
- Type-aware Oxlint, official Effect diagnostics, shadcn lint, Oxfmt, Lefthook,
  CI, and a 200-physical-line file limit.

## Layout

```text
apps/api       Effect Worker, /api/health and protected /api/me
apps/web       React app and same-origin Better Auth client
apps/infra     Alchemy stack composition
packages/auth  Reusable auth service and Cloudflare D1 layer
scripts        Repository file-length gate
```

One Worker serves the built frontend and API. `/api/*` always goes to the Worker;
other requests use static assets with SPA fallback. Private cloud stages route
assets through the Worker too, so its fail-closed Access check protects all paths.
This avoids cross-origin cookies, public backend URLs, and separate CORS setup.

## Install and commands

Use Node >=22.21.1 and pnpm 10.33.4:

```sh
corepack enable
pnpm install
pnpm lint
pnpm build
```

Run `pnpm run` to list scripts:

| Command                                | Purpose                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm lint`                            | Formatting, matching env keys, Oxlint/shadcn, file lengths, Effect, types |
| `pnpm lint:format`                     | Apply formatting fixes                                                    |
| `pnpm lint:format:check`               | Check formatting without changes                                          |
| `pnpm lint:effect`                     | Effect correctness diagnostics for API/auth/infra                         |
| `pnpm lint:typecheck`                  | All workspace and root TypeScript checks                                  |
| `pnpm build`                           | Build the frontend and Worker without deploying                           |
| `pnpm audit`                           | Audit production dependencies for high/critical advisories                |
| `pnpm plan:dev` / `pnpm plan:prod`     | Lint, build, preview infrastructure changes                               |
| `pnpm deploy:dev` / `pnpm deploy:prod` | Lint, build, deploy the chosen cloud stage                                |

`pnpm lint` never applies formatting fixes. The commit hook runs it; CI runs a
frozen install, audit, lint, and build. No local `dev` or separate `check` command
is provided. Workspace `typecheck` scripts are internal Turbo tasks.

Install creates `packages/config/.env.dev` and `.env.prod` without overwriting
edits. Both are gitignored and share `DEV_ACCESS_EMAILS`, `AUTH_BASE_URL`,
and `ALLOW_PRODUCTION`; lint rejects missing or mismatched keys.
Use the matching file for dev/prod; provider credentials stay in Alchemy profiles.
Blank `AUTH_BASE_URL` uses the Worker origin. Alchemy determines execution mode;
auth receives an automatically derived Worker binding, not a manual env flag.

Frontend `@shadcn/lint` rejects raw colors, inline styles, and unknown Tailwind
classes. Configure it in `.oxlintrc.json`; arbitrary-value/restyling rules are
opt-in. Official `@effect/tsgo` error-level correctness rules are configured in
`tsconfig.base.json`. Style suggestions do not gate CI. This standalone checker
does not patch TypeScript/Oxlint or activate Cursor's LSP. No unit-test framework
is included. Narrow pinned dependency overrides address Alchemy toolchain advisories.

The Worker build is an offline verification artifact using Alchemy's public
bundler and Cloudflare plugin. Alchemy builds its deployment bundle again with
stage metadata. Before the first deployment of a copied service, give
`service.config.ts` a unique `serviceName` and update the root package name.
Keep that identity stable after deploying: it identifies persistent resources.

## Cloud development

1. Configure the Cloudflare credentials in the `default` Alchemy profile
   (skip creation if it already exists):

   ```sh
   pnpm --filter @starter/infra exec alchemy profile create default
   pnpm --filter @starter/infra exec alchemy profile edit --profile default --add cloudflare
   ```

2. Set `DEV_ACCESS_EMAILS` in `packages/config/.env.dev` to your team's verified emails,
   comma-separated. Configure Cloudflare Zero Trust/Access and an identity
   provider (email one-time PIN is enough to start) in the account.
3. Bootstrap Alchemy's shared, encrypted Cloudflare state store once:

   ```sh
   pnpm --filter @starter/infra exec alchemy provider cloudflare bootstrap --profile default
   ```

4. Review the plan, then deploy when ready:

   ```sh
   pnpm plan:dev
   pnpm deploy:dev
   ```

5. Open the printed URL, pass Cloudflare Access, and create a **test** account.
   Edit code and redeploy to test the next change on real Cloudflare services.

The development commands explicitly select `--stage dev --profile default`.
This stage owns its Worker, D1 database, signing secret, and Access application.
It does not reference production resources. Access protects the whole site,
including API, workers.dev, and preview URLs; Better Auth is the application
login inside that developer wall. Deployment requires a nonempty Access email
allowlist. Until Access admits a request, the private Worker also returns 403.

If an earlier copy was deployed as `staging`, `dev` creates a different stage;
it does not migrate that stage's users, data, or resources automatically.

### What a plan does

A plan previews resources Alchemy intends to create, update, or delete; it does
not apply the application deployment. It is **not necessarily offline**: plans
access shared cloud state and can prompt to bootstrap or upgrade the state store.
Bootstrap is a real cloud change. Review deletions and persistent-resource changes
before deploying. Deployment recomputes its plan; the preview is not a saved approval.

Serialize deployments to each shared stage; separate stages do not make concurrent
updates to the same stage safe. Cloud usage is billed. Do not run
`alchemy dev --stage dev` or `--stage prod`: local/live replacement is unsafe.
Underlying local mode refuses either cloud stage and requires a `dev_`/`dev-` name.
State and auth settings derive from the actual CLI mode, not a stage env toggle.

## Production

Configure a separate `prod` Alchemy profile, ideally in a separate Cloudflare
account. Use production credentials only for production external services.
Production does not create the developer Access wall. Both planning and deployment
require explicit opt-in: set `ALLOW_PRODUCTION=true` only in
`packages/config/.env.prod` when deliberately preparing a production operation.
Both files default to false. Run:

```sh
pnpm plan:prod
pnpm deploy:prod
```

Set the flag back to false afterward. An explicit Alchemy env file overrides
shell variables, so a shell prefix cannot override false in that file.
Production scripts explicitly select `--stage prod --profile prod`. Before public launch, add email verification
and recovery delivery; review sign-up policy, domains, and migrations. Auth rate
limiting uses D1 and Cloudflare's client-IP header; cloud cookies are secure.
For a custom auth origin, set `AUTH_BASE_URL` to its HTTPS origin without a path.
No email sender, payment provider, or other product-specific service is enabled.

## Manual checks after deployment

- An unauthenticated visit reaches Cloudflare Access, not the application.
- After Access login, `/api/health` returns `{ "ok": true }`.
- `/api/me` returns 401 before application sign-in.
- Sign up with a password of at least 12 characters; refresh to confirm the
  session persists. `/api/me` returns only id, name, and email after sign-in.
- Sign out, then confirm `/api/me` returns 401 again.
- Redeploy the same stage and confirm users/sessions persist.
- Confirm dev and prod do not share databases, signing secrets, or sessions.

Do not delete deployment state or rename stack/auth resource IDs casually:
these identify persistent resources and the signing secret. Never adopt existing
production resources to make a development deployment succeed.

## Adding a service

Add only resources you need. Put reusable services under `packages/`, supply
provider layers at the Worker composition boundary, and keep browser code free
of server imports and secrets. Add schema-defined endpoints in `apps/api`.
SQL migrations beyond Better Auth's additive schema need explicit review.

`pnpm lint` rejects authored files exceeding 200 physical lines, including blanks
and comments, across source, configuration, styles, SQL, and documentation.
Lockfiles, generated output, dependencies, and scratch `var/` notes are excluded.
Keep shadcn components small when adding them through the CLI.

## Ratstack patterns adopted

Studied [ratstack.sh](https://ratstack.sh), its
[pins](https://ratstack.sh/pins.md), [auth](https://ratstack.sh/systems/auth),
[fence](https://ratstack.sh/systems/fence), and
[Alchemy guide](https://ratstack.sh/skills/learn-alchemy).
Adopted typed services/layers, provider boundaries, co-owned infrastructure,
exact dependency pins, and automated lint/type/build gates.
Skipped generic capability projections, MCP, XState, devtools, analytics, and
vendoring: none are needed for a plain service starter.
