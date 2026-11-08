# highchat

A personal workspace for AI conversations, private files and generated images.
Built with Effect, TypeScript and a local Node server. This repository is the
application, not a SaaS starter: commercial billing, checkout, and subscriptions
are removed. AI provider usage and cost tracking remain part of the workspace.

## Existing capabilities

- Saved private transcripts with streamed responses, reconnect, Stop, rename and archive.
- Model/reasoning selection, usage and estimated costs.
- Private files, image references, and optional development voice.
- Account-wide Skills, profile settings, and five appearance themes.

See [chat](docs/pi-chat.md), [files](docs/chat-files.md),
[images](docs/chat-images.md), [voice](docs/chat-voice.md),
[Skills](docs/skills.md), and [dashboard behavior](docs/dashboard-ui.md) for contracts and
acceptance limits.
Source implementation and passing builds do not establish deployed acceptance.
There is no account-wide export or permanent chat deletion promise.

## Stack and layout

pnpm + Turborepo, strict TypeScript 7, Effect 4, Clerk, React/Vite/Tailwind,
assistant-ui and the real Node Pi SDK. No infrastructure-as-code provider, no
edge runtime and no deployment configuration.

```text
apps/api                    Effect Node server, authenticated APIs and chat objects
apps/chat-host              Node Pi SDK sessions and direct extensions
apps/web                    React workspace and same-origin API client
packages/auth               Clerk identity and Backend API user boundaries
packages/chat-contract      Shared chat reference schemas and the typed error contract
packages/chat-runtime       Private API/Node run-channel schemas
packages/config             Private stage configuration defaults and key checks
packages/diagnostics        Shared safe structured diagnostics
packages/integrations       Optional backend Email/Slack adapters
packages/platform           SQLite, object store, runtime env and HTTP boundary
scripts                     Local launchers and repository checks
```

Workspace packages use `@highchat/*`. Keep provider clients and secrets out of
browser code. Add only services the existing application needs. Optional
[Email/Slack](docs/integrations.md) adapters remain backend-only and are not
automatically enabled.

## Install and local development

Use Node >=22.21.1 and pnpm 10.33.4:

```sh
corepack enable
pnpm install
pnpm lint
pnpm build
pnpm dev        # local Pi host at :1338; API and UI assets at :1337
pnpm dev:web    # Vite HMR: main UI :5173, admin UI :5175
```

Open **http://localhost:5173** for the main UI and **http://localhost:5175** for
the admin portal, whose root opens `/admin`. After backend changes, restart the
API.
See [local development](docs/local-development.md) for the complete workflow.

Local storage stays local; configured AI inference is remote and billable. Missing
inference configuration disables sending. Optional voice setup is separate.

## Configuration and compatibility

Install initializes gitignored `packages/config/.env.local` and `.env.prod`.
Both must contain identical keys: `APP_NAME`, `APP_DOMAIN`, `AUTH_BASE_URL`,
`CHAT_MODEL_ALLOWLIST`, `CHAT_HOST_URL` and `CLERK_PUBLISHABLE_KEY`. Secrets are
process environment values: `CLERK_SECRET_KEY`, `OPENROUTER_API_KEY` and the Pi
host token. Local development generates an ephemeral host token.

`APP_NAME` is the display name everywhere; its default is `highchat`. `APP_DOMAIN`
defaults to blank in dev and `highchat.space` in prod. `pnpm build` defaults to dev
configuration; `APP_STAGE=prod pnpm build` selects production public values without
deploying. See [naming and domains](docs/naming.md) for exact boundaries.

Branding/package identity is separate from stored-data identity:

- `service.config.ts` intentionally retains the legacy service name.
- Legacy theme storage keys and account-invalidation event names remain readable
  across the rename. Historical diagnostic provider values remain decodable.
- Local SQLite/object files are not migrated, and the previous deployment's
  resources and auth identities are untouched.

Do not globally replace these compatibility identifiers.

Identity is Clerk. There is no signup/role management inside this app; the
[admin portal](docs/admin-portal.md) reads Clerk Backend API user records and can
grant the app-wide admin role. Users are created in Clerk, not migrated from any
previous identity store.

Commercial billing is preserved in checkpoint `4906c83` in Git history, but is no
longer wired into the application. Any live subscriptions or provider webhooks need
separate operator retirement; removing code is not cancellation of financial
obligations.

## Commands and quality gates

| Command                     | Purpose                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm lint`                 | Formatting check, env-key parity, Oxlint, line limits, Effect diagnostics and types |
| `pnpm lint:format`          | Apply formatting fixes                                                              |
| `pnpm build`                | Build frontend and typecheck every workspace, without deployment                    |
| `pnpm dev` / `pnpm dev:web` | Local API + Pi host / Vite HMR for the main and admin UIs                           |
| `pnpm audit`                | Production dependency advisory check                                                |

Direct dependencies are pinned and the pnpm lockfile is retained. Authored text
files must be <=200 physical lines; dependencies, generated output, lockfiles and
`var/` are excluded. Lint never applies fixes. The commit hook runs lint; CI runs
frozen install, audit, lint and build. No unit-test framework is included.

## Runtime and deployment

One Node process serves the frontend assets and APIs; a second private Node process
runs Pi SDK sessions. Chat objects, SQLite files and object storage are local to the
process host (`var/storage`, override with `CHAT_STORAGE_DIR`). There is no
deployment target in this repository, and adding one is a separate decision with its
own configuration and rollback plan. See [CI](docs/github-cicd.md),
[chat setup](docs/pi-chat.md) and [observability](docs/observability.md).
