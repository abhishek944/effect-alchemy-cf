# Local development

Development starts without optional voice credentials. Voice stays outside the
chat gateway; inject its separate provider values through Doppler. The launcher
preserves injected credentials and no longer reads a private audio profile.

Authenticate the Doppler CLI once (`doppler login`); `pnpm dev` and `pnpm dev:web`
inject project `effect-boilerplate` config `dev`. Then run from the repository root:

```sh
pnpm install
pnpm build:dev    # configured dev web assets served by the API on :1337
pnpm dev          # terminal 1: Node Pi host + the local API and UI assets
pnpm dev:web      # terminal 2: Vite main UI (:5173) and admin UI (:5175)
```

Open **http://localhost:5173** for the main UI and **http://localhost:5175** for
the admin portal, whose root is the portal; `/users` is its Users section. The main
origin has no admin route.

## One local process

`pnpm dev` starts two Node processes and nothing else:

1. the Pi SDK host on `127.0.0.1:1338` with an ephemeral in-memory service token
   (it prints no token and stops with the API);
2. the API server on `127.0.0.1:1337` from `apps/api/src/server.ts`.

There is no workerd, no Durable Object, no Cloudflare account and no infrastructure
plan. Chat objects run in-process: one SQLite file per chat object under
`var/storage/chat/`, per-object requests serialized by an in-process queue, and file
bytes in `var/storage/objects/`. `CHAT_STORAGE_DIR` overrides that location. The
directories are gitignored; deleting them resets local data.

`pnpm dev:web` serves `apps/web` with Vite hot module replacement and proxies
same-origin `/api` traffic to the API on localhost:1337. Both Vite servers bind
only to localhost and fail if port 5173 (main UI) or 5175 (admin UI) is
unavailable, so there is no silent fallback port. The admin server selects the
admin surface, while the main server never routes admin UI. Each surface keeps
one browser origin for its app and proxied API, which preserves the session cookie
and Server-Sent Events.

## Identity

Clerk is the only identity provider. Create a development instance and set:

```sh
CLERK_SECRET_KEY=sk_test_…          # server only, never committed
CLERK_PUBLISHABLE_KEY=pk_test_…     # safe for the browser
```

Set `CLERK_PUBLISHABLE_KEY` in the Doppler `dev` config. `pnpm dev:web` and
`pnpm build:dev` run under `doppler run`, so Vite reads it from the final inherited
environment and exposes it as `PUBLIC_CLERK_PUBLISHABLE_KEY`; any value that is
not a `pk_…` publishable key is refused so a secret key can never reach the
bundle. A blank key falls back to the stage default, which is blank. Plain
`pnpm build` is the credential-free CI path and never contacts Doppler.
Server-side, the process environment supplies `CLERK_SECRET_KEY`; put it in the
Doppler config or the shell that runs `pnpm dev`.

With no Clerk secret configured the API still starts and answers `/api/health`;
every authenticated route fails closed with a typed `503 AuthenticationUnavailable`
rather than treating the request as signed out. This change was verified only to
that point: no live Clerk instance was configured, so sign-in, sign-out, cookie
transport, SSE authentication and admin claims remain unverified.

Admin authority is app-wide: `publicMetadata.role = "admin"` on the Clerk user,
set from the Clerk dashboard. The server reads the live user record on every admin
request, so a role change applies immediately. There is no one-time access token.

## Model transport

Chat inference uses LiteLLM only. Inject the stage-specific gateway/identity
settings described in [gateway setup](chat-gateway.md). No separate manual model
allowlist, direct-provider key or profile enables chat. Missing configuration keeps
saved chats readable but refuses affected new work before paid admission. Reporting
and metadata-only Langfuse tracing have independent credentials/failure behavior.
Images activate only for supported discovered gateway mappings; optional text/JSON
classification requires the explicit server model/API names in gateway setup. Voice
remains outside the gateway. No operator resources are created by the launcher.

## Isolation and configuration

Obsolete keys from the previous runtime (`DEV_ACCESS_EMAILS`, `ALLOW_PRODUCTION`,
`CHAT_GATEWAY_ID`) may still exist in the Doppler config; they are ignored and can
be deleted by hand. No stage env file is read or created. `CLERK_PUBLISHABLE_KEY`
is the one public browser value, and `turbo.json` lists it in `globalEnv` so a
change to it both reaches the Vite process and invalidates the build cache.

Public `APP_NAME` branding and nonsecret chat/model settings come from the Doppler
`dev` config. The `prd` config is never loaded locally, and no `pnpm dev` argument
can select a cloud stage. `pnpm lint` validates the active configuration and, when
Doppler injected it, fails on a missing shared key.

## Branding and build stage

`APP_NAME` in the Doppler `dev` config supplies the local UI and backend name.
Restart both the API and Vite after changing it. `APP_DOMAIN` never attaches a
domain locally; auth and API calls stay same-origin on localhost.
Run `pnpm build:dev` for the configured dev web assets served on :1337; plain
`pnpm build` is the credential-free CI build with shared defaults. `pnpm build:prod`
(or `APP_STAGE=prod doppler run -c prd -- pnpm build`) is an explicit offline
build with production public values, not a deployment.

See [naming](naming.md).

## Diagnostic output

The launcher inherits stdout/stderr for the entire process lifetime. Every request
logs one JSON line with a request id, service, stage, release, route, status and
duration. Failures log one `application.failure` record with the cause chain;
credentials, prompts and file contents are never logged.

If the Pi host exits, the API stops too. Finalized transcripts and receipts stay in
local storage, and accepted model work is never replayed.
