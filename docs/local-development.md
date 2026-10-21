# Local development

Development starts without optional voice credentials. To enable dictation and
read aloud, complete [speech setup](chat-voice.md) with the private `default`
OpenRouter profile and its `dev_local` key. Missing credentials disable voice only;
malformed or unsafe supplied profiles still fail validation.

Run from the repository root:

```sh
pnpm install
pnpm dev
```

Open **http://localhost:1337**. No Cloudflare Access email code is needed.
The command builds the frontend and Worker, then serves a fixed local build
through Alchemy's programmatic API. Workers execute in workerd; D1 and
signing-secret storage use local providers. No file watcher or poller runs.
Better Auth still requires ordinary application signup/signin. Local users and
sessions are separate from the deployed cloud development database.

## Isolation and configuration

The runner fixes stage `dev_local`, profile `default`, and local-provider mode;
the launcher cannot select shared cloud `dev` or `prod` and rejects extra
arguments. Alchemy uses local state in
this mode. It does not create the cloud Access application or email PIN provider.
The server binds only to localhost and fails if port 1337 is unavailable.
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
`packages/config/.env.dev`, then run plain `pnpm dev`:

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

Docker must be running. `pnpm dev` prepares and builds the Office application
image locally, inspects its immutable Docker image ID, and binds that existing
image to the local Worker. It does not publish an image or deploy to Cloudflare.
The first build downloads pinned base-image and package dependencies. Subsequent
builds reuse Docker's cache. Normal `pnpm build` alone does not build the image.

The launcher supplies `OFFICE_IMAGE_REF` from the actual local image inspection;
do not configure a registry reference for local development. Cloud deployments
still require their own immutable Cloudflare registry image. See [Office](office.md).
Source/static checks alone do not prove container startup or Office functionality.

## Editing

There is no automatic reload for the stack, Worker, API, auth, or frontend.
The local runner applies the stack once; the Worker source builds one
stage-specific bundle at startup and never watches source files. Built frontend
assets are served by the same Worker, with no separate Vite server or hot reload.

After any source or configuration change:

1. Stop the running service with Ctrl+C.
2. Run `pnpm dev` again to rebuild and start the updated service.
3. Refresh the browser.

Do not rebuild while dev is serving: its asset index can become stale and return
SPA HTML for new hashed JS/CSS URLs, causing a blank page. Stop dev before build
checks, then restart it. Use `pnpm lint` and `pnpm build` before handing off changes.

## User-owned acceptance checks

1. Confirm the printed URL is localhost:1337 and resource IDs are local (`dev:`).
2. Open `/api/health`; expect `{ "ok": true }` without an Access login page.
3. Open `/api/me`; expect 401 before application signin.
4. Sign up with a test account and a password of at least 12 characters.
5. Refresh and confirm the session persists; `/api/me` returns your user.
6. Sign out and confirm `/api/me` returns 401 again.
7. Restart `pnpm dev`, then sign in with the same account to check persistence.
8. Edit an API source file and confirm it does not reload automatically; restart
   `pnpm dev` and confirm the new build is served.
9. After explicit dev Gateway/BYOK setup, check saved chats, streaming, Stop and
   refresh/reconnect using the [Pi chat acceptance steps](pi-chat.md).

Local auth uses non-secure HTTP cookies and disables its cloud rate limiter.
Local tests do not prove deployed Access, HTTPS cookies, real Cloudflare D1
behavior or native observability. Use the existing plan/deploy cloud commands
for those checks after review and approval. Cloud Access remains enabled;
non-interactive cloud service tokens are not configured by this change.
