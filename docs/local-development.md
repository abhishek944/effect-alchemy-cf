# Local development

Development starts without optional voice credentials. To enable dictation and
read aloud, complete [speech setup](chat-voice.md) with the private `default`
OpenRouter profile and its `dev_local` key. Missing credentials disable voice only;
malformed or unsafe supplied profiles still fail validation.

Run from the repository root:

```sh
pnpm install
pnpm dev          # terminal 1: Node Pi host + the local API and UI assets
pnpm dev:web      # terminal 2: Vite main UI (:5173) and admin UI (:5175)
```

Open **http://localhost:5173** for the main UI and **http://localhost:5175** for
the admin portal, whose root opens `/admin`.

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
unavailable, so there is no silent fallback port. Each surface keeps one browser
origin for its app and proxied API, which preserves the session cookie and
Server-Sent Events.

## Identity

Clerk is the only identity provider. Create a development instance and set:

```sh
CLERK_SECRET_KEY=sk_test_…          # server only, never committed
CLERK_PUBLISHABLE_KEY=pk_test_…     # safe for the browser
```

Set `CLERK_PUBLISHABLE_KEY` in `packages/config/.env.local`; the stage file is the
source of truth and Vite injects it as `PUBLIC_CLERK_PUBLISHABLE_KEY` for both
`pnpm dev:web` and `pnpm build`. A blank stage value falls back to a shell
`CLERK_PUBLISHABLE_KEY`, and any value that is not a `pk_…` publishable key is
refused so a secret key can never reach the bundle. Server-side, the process
environment supplies `CLERK_SECRET_KEY`; export it in the shell that runs
`pnpm dev`.

With no Clerk secret configured the API still starts and answers `/api/health`;
every authenticated route fails closed with a typed `503 AuthenticationUnavailable`
rather than treating the request as signed out. This change was verified only to
that point: no live Clerk instance was configured, so sign-in, sign-out, cookie
transport, SSE authentication and admin claims remain unverified.

Admin authority is app-wide: `publicMetadata.role = "admin"` on the Clerk user,
set from the Clerk dashboard. The server reads the live user record on every admin
request, so a role change applies immediately. There is no one-time access token.

## Model transport

Chat inference needs a configured HTTP provider credential:

```sh
OPENROUTER_API_KEY=…   # shell or a private profile; never committed
```

With no key the app runs, but sending stays unavailable with a typed, explicit
failure; nothing silently falls back to another provider. Paid image generation has
no configured transport in this runtime and reports itself as not configured.

## Isolation and configuration

Obsolete keys from the previous runtime (`DEV_ACCESS_EMAILS`, `ALLOW_PRODUCTION`,
`CHAT_GATEWAY_ID`) may still exist in a stage file created earlier; they are
ignored and can be deleted by hand. `CLERK_PUBLISHABLE_KEY` is the one public
browser value, and `turbo.json` lists it in `globalEnv` so a change to it both
reaches the Vite process and invalidates the build cache.

Public `APP_NAME` branding and nonsecret chat/model settings come from
`packages/config/.env.local`. `.env.prod` is never loaded locally, and no
`pnpm dev` argument can select a cloud stage. Both stage files must contain
identical keys; `pnpm lint` enforces that.

## Branding and build stage

`APP_NAME` in `.env.local` supplies the local UI and backend name. Restart both the
API and Vite after changing it. `APP_DOMAIN` never attaches a domain locally; auth
and API calls stay same-origin on localhost.
`pnpm build` loads dev configuration before Turbo; `APP_STAGE=prod pnpm build`
is an explicit offline build with production public values, not a deployment.

See [naming](naming.md).

## Diagnostic output

The launcher inherits stdout/stderr for the entire process lifetime. Every request
logs one JSON line with a request id, service, stage, release, route, status and
duration. Failures log one `application.failure` record with the cause chain;
credentials, prompts and file contents are never logged.

If the Pi host exits, the API stops too. Finalized transcripts and receipts stay in
local storage, and accepted model work is never replayed.
