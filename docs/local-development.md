# Local development

Development starts without optional voice credentials. To enable dictation and
read aloud, complete [speech setup](chat-voice.md) with the private `default`
OpenRouter profile and its `dev_local` key. Missing credentials disable voice only;
malformed or unsafe supplied profiles still fail validation.

Run from the repository root:

```sh
pnpm install
pnpm dev:office   # once, and after Office job/container changes
pnpm dev          # terminal 1: local Worker, auth, D1/R2 and Office binding
pnpm dev:web      # terminal 2: Vite frontend
```

Open **http://localhost:5173**. No Cloudflare Access email code is needed.
`pnpm dev` applies the `dev_local` stack once through Alchemy's programmatic API
and keeps the Worker stable; it does not watch source. `pnpm dev:web` serves
`apps/web` with Vite hot module replacement and proxies same-origin `/api`,
Office WebSocket and `/universer-api` traffic to the Worker on localhost:1337.
Workers execute in workerd; D1 and signing-secret storage use local providers.
Better Auth still requires ordinary application signup/signin. Local users and
sessions are separate from the deployed cloud development database.

## Isolation and configuration

The runner fixes stage `dev_local`, profile `default`, and local-provider mode;
the launcher cannot select shared cloud `dev` or `prod` and rejects extra
arguments. Alchemy uses local state in
this mode. It does not create the cloud Access application or email PIN provider.
The Worker binds only to localhost and fails if port 1337 is unavailable. Vite
binds only to localhost and fails if port 5173 is unavailable; the pinned
origin is also the only extra local auth origin, so there is no silent fallback
port. Keeping one browser origin for the app and proxied API preserves local
cookies, Server-Sent Events and WebSocket upgrades.
The pinned local workerd uses compatibility date `2026-09-25`; cloud Workers
retain `2026-10-05`. Cloud checks are required for differences between these dates.

Nonsecret chat/model and billing catalog/account settings are read from
`packages/config/.env.dev`; the file's Gateway setting overrides the shell. The
development audio key comes from the private OpenRouter profile, never `.env.dev`
or another stage file. Billing uses test-only credentials from the default
profile (see [billing setup](billing-setup.md)). `.env.prod` is never loaded. The launcher
pins `AUTH_BASE_URL` to blank (same-origin) and `ALLOW_PRODUCTION` to false in its
child environment, preventing inherited cloud settings from redirecting local auth.
Provider credentials remain in profiles; never copy production credentials into
local configuration. Local state/data live under ignored `.alchemy/`; preserve
that directory to keep local users between runs and do not commit it.

Auth, assets and chat storage use local providers. Pi chat inference is an
explicit exception: set the nonsecret `CHAT_GATEWAY_ID` to the development
Gateway after provisioning its OpenAI BYOK default key securely in Cloudflare.
Then local sends call GPT-6 Luna remotely and incur usage charges. Blank Gateway
configuration must not attach a remote AI proxy and leaves sending unavailable.
See [Pi chat setup](pi-chat.md). Never use a production Gateway locally.
After the development Gateway and its BYOK key are configured, set this in
`packages/config/.env.dev`, then restart `pnpm dev`:

```dotenv
CHAT_GATEWAY_ID=servicestarter-dev-chat
```

Use your service's development Gateway ID if you renamed `serviceName`.
A blank file setting disables inference, even if the shell supplies a Gateway.
Both stage files contain the key, but `.env.prod` needs a separate production
Gateway ID; leave it blank until that Gateway is provisioned. Restart after edits.
**Alchemy dev is not a universal no-cloud guarantee:** remote bindings can
provision cloud proxy resources. Review them before starting changed stacks.
Never run `alchemy dev --stage dev` or `--stage prod`.

## Local Office container

Docker must be running. `pnpm dev:office` prepares and builds the Office
application image locally and inspects its immutable Docker image ID; run it
once and after Office job/container changes. `pnpm dev` only inspects the
existing `starter-office-local:dev` image and binds that ID to the local Worker;
it never builds, pulls or publishes an image. If the image is missing, the
launcher stops with an instruction to run `pnpm dev:office`. The first build
downloads pinned base-image and package dependencies. Subsequent builds reuse
Docker's cache. Normal `pnpm build` alone does not build the image.

The launcher supplies `OFFICE_IMAGE_REF` from the actual local image inspection;
do not configure a registry reference for local development. Restart `pnpm dev`
after rebuilding the image so the new immutable ID is bound. Cloud deployments
still require their own immutable Cloudflare registry image. See [Office](office.md).
Source/static checks alone do not prove container startup or Office functionality.

## Local Office host lifetime

Local Office hosts do not retire when idle by default, so an unused editor is
not closed just because its last activity aged out. Opt in to the explicit
local lifecycle check when you need it:

```sh
OFFICE_LOCAL_IDLE=true pnpm dev
```

`pnpm dev` forwards the shell environment and the Worker binds the nonsecret
`OFFICE_LOCAL_IDLE` value as `yes`/`no`. Only stage `dev_local` disables idle
retirement by default; cloud `dev` and `prod` keep their existing idle policy
regardless of this local flag. The flag changes only when local hosts retire:
it does not repair pause/cleanup failures, and static checks do not prove
idle-retirement behavior at runtime.

## Diagnostic output

The standard launcher inherits stdout/stderr for the entire process lifetime.
Keep them attached after readiness. Structured failure records use fixed
component/operation/reason markers and existing request/task/operation IDs; see
[observability](observability.md). Do not replace them with raw error/body dumps
or a wrapper that silently drops post-startup output. A generated `x-request-id`
joins API failures to request completion; native tool/job failures also need
their existing operation or task identity. Local runs report release
`local-<startup stamp>` (non-SHA manual/cloud runs use `manual-<stamp>`); the
stamp marks the startup, not a versioned build. The inspected Docker image ID
is the local Office build identity (see [Office](office.md)). Correlate local
records by `x-request-id` or operation/task IDs on stdout/stderr; finite
`application.phase` and `application.complete` records mark progress and
terminal outcomes. Browser failures additionally project fixed phase/reason
records to the local browser console only. Delivery beyond these local sinks
(cloud logs, provider paths, external collectors) is explicitly unverified
here.

Backend source changes do not update a running Worker; frontend source changes
update through Vite. Static checks alone do not verify authenticated tool
execution, provider outcomes or native job log delivery.

## Editing

The Worker, API, auth and stack do not reload automatically. Vite watches the
frontend and its imported workspace sources, so CSS/React edits update the
browser without a Worker restart, Docker build or full `pnpm build`. If
`apps/web/dist` has never been built, the Worker logs a missing-assets warning;
that is expected in Vite development and does not affect the API.

After a change:

1. Frontend/CSS/React edit: keep both commands running; Vite updates the browser.
2. Office frame source change: run
   `pnpm --filter @starter/office-react build:frame`, then refresh the browser.
   Vite serves the built frame from `packages/office-react/dist` under `/office/`
   so the iframe stays same-origin and authenticated. A missing frame build
   returns a 503 with that command instead of breaking the rest of the app.
3. Worker, API, auth, `.env.dev` or backend configuration change: stop `pnpm dev`
   with Ctrl+C and start it again. Vite can keep running.
4. Office job/container change: run `pnpm dev:office`, then restart `pnpm dev`
   so the new image ID is bound.

For a production-like check of the built frontend, stop `pnpm dev`, run
`pnpm build`, start `pnpm dev`, and open **http://localhost:1337**. The Worker
serves `apps/web/dist` at that URL. Do not rebuild while it is serving: its asset
index can become stale and return SPA HTML for new hashed JS/CSS URLs, causing a
blank page. Use `pnpm lint` and `pnpm build` before handing off changes.

## User-owned acceptance checks

1. Confirm Vite serves http://localhost:5173 and the Worker prints
   http://localhost:1337 with local (`dev:`) resource IDs.
2. Open http://localhost:1337/api/health; expect `{ "ok": true }` without an
   Access login page.
3. Open http://localhost:5173/api/me; expect 401 before application signin.
4. Sign up with a test account and a password of at least 12 characters.
5. Refresh and confirm the session persists; `/api/me` returns your user.
6. Sign out and confirm `/api/me` returns 401 again.
7. Restart `pnpm dev`, then sign in with the same account to check persistence.
8. Edit a CSS/TSX file under `apps/web` and confirm Vite updates the browser
   without restarting the Worker, rebuilding the image or running `pnpm build`.
9. Edit an API source file and confirm it does not reload automatically; restart
   `pnpm dev` and confirm the new build is served.
10. Open an Office panel and confirm `/office/frame.html` loads after
    `pnpm --filter @starter/office-react build:frame` when the frame is not built.
11. After explicit dev Gateway/BYOK setup, check saved chats, streaming, Stop and
    refresh/reconnect using the [Pi chat acceptance steps](pi-chat.md).

Local auth uses non-secure HTTP cookies and disables its cloud rate limiter.
Local tests do not prove deployed Access, HTTPS cookies, real Cloudflare D1
behavior or native observability. Use the existing plan/deploy cloud commands
for those checks after review and approval. Cloud Access remains enabled;
non-interactive cloud service tokens are not configured by this change.
