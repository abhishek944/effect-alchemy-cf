# highchat

A personal workspace for AI conversations, private files, and Office documents.
Built with Effect, Alchemy, and Cloudflare. This repository is the application,
not a SaaS starter: commercial billing, checkout, and subscriptions are removed.
AI provider usage and cost tracking remain part of the workspace.

## Existing capabilities

- Saved private chats with durable responses, reconnect, Stop, rename and archive.
- Model/reasoning selection, usage and estimated costs.
- Private files, image generation/references, and optional development voice.
- Account-wide Skills, profile settings, and five appearance themes.
- Native Office editing, AI drafts, human review and document exports.

See [chat](docs/pi-chat.md), [files](docs/chat-files.md),
[images](docs/chat-images.md), [voice](docs/chat-voice.md),
[Skills](docs/skills.md), [Office](docs/office.md), and
[dashboard behavior](docs/dashboard-ui.md) for contracts and acceptance limits.
Source implementation and passing builds do not establish deployed acceptance.
There is no account-wide export or permanent chat deletion promise.

## Stack and layout

pnpm + Turborepo, strict TypeScript 7, Effect 4, Alchemy 2 beta,
Better Auth, React/Vite/Tailwind, assistant-ui and Pi Durable.

```text
apps/api                    Effect Worker, authenticated APIs and durable chat
apps/web                    React personal office and same-origin auth client
apps/infra                  Alchemy stack composition
apps/office                 Native document host and isolated job image
packages/auth               Auth, D1 adapter and session boundaries
packages/config             Private stage configuration defaults and key checks
packages/diagnostics        Shared safe structured diagnostics
packages/integrations       Optional backend Email/Slack adapters
packages/office-contract    Office schemas, client and wire contracts
packages/office-server      Office services, ports and isolated jobs
packages/office-cloudflare  D1 metadata and R2/native storage adapters
packages/office-react       Native editor frame and review UI
packages/office-pi          AI Office tools and host integration
scripts                     Local/cloud launchers and repository checks
```

Workspace packages use `@highchat/*`. Keep provider clients,
infrastructure and secrets out of browser code. Add only services the existing
application needs; no new tasks, memory, scheduling or connectors are introduced
by this refactor. Optional [Email/Slack](docs/integrations.md) adapters remain
backend-only and are not automatically enabled.

## Install and local development

Use Node >=22.21.1 and pnpm 10.33.4:

```sh
corepack enable
pnpm install
pnpm lint
pnpm build
pnpm dev:office  # explicitly build the local Office image when needed
pnpm dev        # local Worker, auth, storage and Office binding at :1337
pnpm dev:web    # Vite HMR frontend at :5173
```

Open **http://localhost:5173**. Docker must run for Office. `pnpm dev` inspects an
existing image; it does not build, pull or publish one. After backend changes,
restart the Worker. After Office host/job changes, rebuild its image and restart.
Stop the local Worker before `pnpm build`; do not overwrite live hashed assets.
See [local development](docs/local-development.md) for the complete workflow.

Local storage stays local, but configured AI inference is remote and billable.
Use only the development Gateway/provider credentials, never production resources.
Missing inference configuration disables sending; optional voice setup is separate.

## Configuration and compatibility

Install initializes gitignored `packages/config/.env.dev` and `.env.prod`.
Both must contain identical keys: `APP_NAME`, `APP_DOMAIN`, `DEV_ACCESS_EMAILS`,
`AUTH_BASE_URL`, `ALLOW_PRODUCTION`, `CHAT_GATEWAY_ID`, and `CHAT_MODEL_ALLOWLIST`.
Provider credentials stay in private profiles, never stage files or browser code.
`APP_NAME` is the display name everywhere; its default is `highchat`. `APP_DOMAIN`
defaults to blank in dev and `highchat.space` in prod. Cloud auth derives its HTTPS
origin from that hostname; an explicit `AUTH_BASE_URL` must match. With neither,
auth uses the request origin. Local mode always keeps localhost/same-origin auth.
Both stages default to `ALLOW_PRODUCTION=false`.

Edit these stage values to rebrand, then restart local Worker/Vite or rebuild and
redeploy the cloud application. Only the public name enters the browser bundle.
`pnpm build` defaults to dev configuration; `APP_STAGE=prod pnpm build` selects
production public values without deploying. Cloud plan/deploy commands select
their stage before lint/build; Turbo hashes the public values and config inputs.
See [naming and domains](docs/naming.md) for exact boundaries and rollout cautions.

Branding/package identity is separate from deployment and stored-data identity:

- `service.config.ts` intentionally retains the legacy Alchemy stack name
  `ServiceStarter`; its development Gateway remains `servicestarter-dev-chat`.
- The existing local image tag `starter-office-local:dev` and Docker ownership
  labels are retained so existing images/jobs remain discoverable.
- Legacy theme storage keys and account-invalidation event names remain readable
  across the rename. Historical diagnostic provider values remain decodable.
- D1/R2 resource IDs, Durable Object classes, auth signing/session identity,
  database contents, `.alchemy` state and provider profiles are not migrated.

Do not globally replace these compatibility identifiers. Renaming infrastructure,
the hosted GitHub repository, or the checkout directory is a separate operation.
Rebuild Office images after source/package changes; preserving a tag does not
make an older image match new source/protocol provenance.

Auth still uses the existing signup/signin and optional
[admin recovery/role portal](docs/admin-portal.md). This refactor does not silently
close signup, replace auth, or remove owner recovery. Cloud development is
Access-gated; production retains application authentication without that developer
wall. A different owner-only access policy requires an explicit follow-up decision.

Commercial billing is preserved in checkpoint `4906c83` in Git history, but is no
longer wired into the application. No historical billing tables/rows are deleted.
Any live subscriptions or provider webhooks need separate operator retirement;
removing code is not cancellation of financial obligations.

## Commands and quality gates

| Command                                | Purpose                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm lint`                            | Formatting check, env-key parity, Oxlint, line limits, Effect diagnostics and types |
| `pnpm lint:format`                     | Apply formatting fixes                                                              |
| `pnpm build`                           | Build frontend/frame/Worker and check Office types, without deployment              |
| `pnpm dev` / `pnpm dev:web`            | Local Worker / Vite HMR                                                             |
| `pnpm dev:office`                      | Explicit local Office image build                                                   |
| `pnpm audit`                           | Production dependency advisory check                                                |
| `pnpm plan:dev` / `pnpm plan:prod`     | Lint, build and preview cloud changes                                               |
| `pnpm deploy:dev` / `pnpm deploy:prod` | Lint, build and deploy an approved stage                                            |

Direct dependencies are pinned and the pnpm lockfile is retained. Authored text
files must be <=200 physical lines; dependencies, generated output, lockfiles and
`var/` are excluded. Lint never applies fixes. The commit hook runs lint; CI runs
frozen install, audit, lint and build. No unit-test framework is included.

## Cloud development and production

One Worker serves the frontend and APIs. Authenticated files and Office frames
remain same-origin. Cloud dev protects assets/API through Cloudflare Access;
local mode binds only to localhost and has separate users/storage.

Use the `default` profile for isolated cloud `dev` and a separate `prod` profile
for production. Bootstrap the encrypted cloud state store only with approval:

```sh
pnpm --filter @highchat/infra exec alchemy profile create default
pnpm --filter @highchat/infra exec alchemy profile edit --profile default --add Cloudflare
pnpm --filter @highchat/infra exec alchemy provider cloudflare bootstrap --profile default
```

Review [local/cloud setup](docs/local-development.md),
[CI/CD](docs/github-cicd.md), [chat setup](docs/pi-chat.md), and
[observability](docs/observability.md) before cloud use. Plans can access shared
cloud state and prompt for a state-store bootstrap/upgrade; they are not necessarily
offline. Inspect persistent-resource changes and deletions before deployment.

GitHub checks PRs and main/prod pushes; only `prod` pushes deploy, using the
production GitHub environment after checks. PRs/main never receive cloud secrets
or deploy. Serialize stage deployments and keep dev/prod databases, signing
secrets, Gateways, provider credentials and sessions isolated.

Production planning/deployment requires deliberate `ALLOW_PRODUCTION=true` in
`.env.prod`; restore false afterward. Do not run local Alchemy dev against cloud
`dev`/`prod`. Do not rename stacks, delete state, adopt resources, deploy or destroy
resources casually. Read the plan and obtain approval before cloud changes.
