---
name: service-startup
description: Start, inspect, or safely restart this repository's local API, private Pi host, main UI and admin UI. Verify ownership and readiness internally; hand off only App, Admin and LiteLLM links.
---

# Service startup

Use for this repository only. Follow the global `implement` workflow and repository
instructions. A documentation request alone does not authorize starting or restarting
services. Do not commit, deploy, provision integrations, or change configuration.

## Read the current contract

Resolve the repository root from this skill directory (`../../..`) and run commands
there, not from another checkout. Read these before acting:

- [Local development](../../../docs/local-development.md).
- [Runtime](../../../docs/runtime.md) and [gateway setup](../../../docs/chat-gateway.md).
- [Package scripts](../../../package.json), [API/host launcher](../../../scripts/local.ts),
  [host lifecycle](../../../scripts/local-chat-host.ts), and
  [web launcher](../../../scripts/web.ts).

Recheck scripts and nonsecret listener metadata each time; documentation is not
proof that a service is running. Never inspect ignored `.env` files, private
profiles, Doppler secret output, process environments, or provider credentials.

## Inspect and preserve existing owners

1. Discover listeners on API 1337, private host 1338, main UI 5173 and admin UI 5175
   with `lsof -nP -iTCP:<port> -sTCP:LISTEN`. API `HOST`/`PORT` can override defaults;
   use actual nonsecret listener metadata rather than guessing an alternate URL.
2. Resolve each listener's cwd (`lsof -a -p <pid> -d cwd`), parent PID and launcher
   tree. Inspect only the relevant process command lines; never dump environments.
   Match the real checkout, command, user and owning terminal/monitor before reuse
   or restart. An occupied port is not permission to kill its listener.
3. Reuse healthy matching services. Preserve unrelated and retained user services.
   Coordinate with their owner before replacing them; do not close an owning
   terminal merely because a delegated task or verification has finished.
4. Before an authorized restart, check the owner's known active chat/image/classifier
   work. Do not interrupt or replay accepted paid work; let it settle or obtain
   explicit direction to stop it. This is not permission for new model/report calls.

For a restart, signal only the verified owning launcher/tree gracefully with
SIGINT or SIGTERM. `local.ts` stops its API and then closes its private Pi host;
`web.ts` stops both Vite children. Verify those exact processes exited and their
ports are released before relaunching. Never use broad `pkill`/`killall`, kill all
Node processes, or assume a stale PID still belongs to this checkout. Diagnose
failed shutdown with the owner instead of escalating blindly. Preserve storage.

## Supported startup

Use pnpm and installed dependencies. If dependencies are missing, use the existing
lockfile (`pnpm install --frozen-lockfile`); do not update dependency versions.
Doppler CLI authentication must already be available; leave interactive login and
credentials to the user. Do not create stage env files or print injected values.

```sh
# From the repository root, only when startup is authorized:
pnpm build:dev  # optional: refresh configured assets served by the API
pnpm dev        # API plus its private Pi host
pnpm dev:web    # separate owner: main and admin Vite servers
```

`dev`, `dev:web`, `build:dev` and `start` inject Doppler project
`effect-boilerplate`, config `dev`. `local.ts` pins `APP_STAGE=dev` and accepts no
stage argument. Doppler `prd` corresponds to `APP_STAGE=prod`, not `prd`.
`pnpm build:prod` is an explicit offline build, not a production service launcher
or deployment. `pnpm start` starts the API only; it does not start the private host
and is not a substitute for the full local stack.

The API runs source without a file watcher. Restart it deliberately after relevant
source/config edits; Vite has its existing HMR. `pnpm build:dev` refreshes API-served
web assets; plain `pnpm build` is the credential-free CI build. Neither starts the
stack. Do not delete `var/storage`, change its ownership, or run two APIs against
one storage directory.

Use retained owning terminals/agents with `MonitorCreate` for long-lived commands.
Record their real terminal/monitor IDs in task artifacts, not the final user handoff.
A short-lived worker must arrange a retained owner before launching; completing or
closing that worker must not stop the user's services. Keep service monitors
separate from lint/build monitors and verify their state through `MonitorList`.

## LiteLLM is a separate existing operator service

Read the operator checkout's `/Users/abhishektatikella/Documents/astack/services/pi-litellm/README.md`
and `compose.yaml` for current exposure. They document LiteLLM 1.108.4, loopback
origin `http://127.0.0.1:4000` by default, and the Admin UI at
**http://127.0.0.1:4000/ui/** (`/ui` redirects there). The host port is overridable
with `LITELLM_PORT`; this documented address is not a promise about a future run.

Confirm the actual published loopback port using nonsecret Docker port metadata
before reporting it as the live address:

```sh
docker ps --filter label=com.docker.compose.project=pi-litellm --format '{{.Names}} {{.Ports}}'
```

Doppler project `effect-boilerplate`, config `dev`, owns this service's existing
master key, encryption salt, bootstrap UI login and DB password. The operator
README documents its exact allowlist and startup command: use `doppler run` with
`--no-fallback --preserve-env=false --only-secrets` and Compose with
`--env-file /dev/null`. The legacy `.env` has been removed; there is no
`env_file` or whole-Doppler forwarding. Missing Doppler inputs fail before startup.
Run from an authenticated directory (currently this repository) and select the
operator service with Compose `--project-directory`; do not copy credentials.

This does not authorize inspecting or changing secrets or starting the operator
stack. Do not read `.env`, render `docker compose config`, or dump container
environments. If metadata is unavailable, publish the documented address as
**live availability unverified**; never invent a domain or assume port 4000.

The application `LITELLM_BASE_URL` is the approved gateway **origin**, without
`/v1` or `/ui`; the web address is that confirmed origin plus `/ui/`. An operator
origin differing from this local Compose exposure needs independent evidence.
App startup does not start/restart Docker or LiteLLM. Preserve this separately owned
stack and database; no bootstrap, login, model/key/customer creation, provider setup,
paid probes, reporting requests or telemetry exports belong to startup.

## Readiness and handoff

When checks are authorized, use bounded non-inference HTTP probes only: API
`/api/health`, main/admin static HTML/assets, and optionally LiteLLM `/ui/`.
For example, this checks the UI shell without login:

```sh
curl --noproxy '*' -sS --max-time 10 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/ui/
```

Inspect only safe status/redirect/content-type output; do not submit forms or authentication data.
The private host at `127.0.0.1:1338` uses an ephemeral service token and is not a
browser UI or public API. Check its listener/readiness log, never reveal its token
or bypass that boundary.

Keep ownership, commands, stage, safe check evidence and each surface's verified,
reused, unavailable or unverified status in task artifacts, not routine final copy.
The final user handoff must contain exactly these three links, with addresses
adjusted only from observed overrides:

- **App**: http://localhost:5173/
- **Admin**: http://localhost:5175/
- **LiteLLM**: http://127.0.0.1:4000/ui/

Do not add Users, Usage, API health, API-served built UI or private-host links,
owner IDs, commands, stage or extra explanatory copy unless explicitly requested.
Briefly mention a concrete failure or unverified availability when needed for
honesty; never imply an unchecked or unavailable service passed.

HTTP 200, a healthy container or a host readiness line proves only that surface's
readiness, not Clerk/admin authorization, authenticated browser flows, model
availability, successful inference, usage accuracy or tracing delivery.
Missing model/inference/report/tracing settings may legitimately disable features;
report the current boundary without hardcoding temporary absences, enabling them,
or falling back to direct providers. Leave live authenticated/paid acceptance to
the user unless separately authorized. Do not claim checks that were not run.
