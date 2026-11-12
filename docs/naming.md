# Naming and custom domains

**Current runtime:** identity is Clerk, storage is local SQLite and files, and no cloud domain or provider resource is attached by this repository. See [runtime](runtime.md). The sections below that
describe the removed stack are historical and no longer describe how this repository
runs.

## Editable branding

Values live in the Doppler `dev` and `prd` configs of project `effect-boilerplate`;
`doppler run` injects them. Defaults come from `packages/config/defaults.ts`:

| Key          | Dev default | Prod default     | Consumer                                 |
| ------------ | ----------- | ---------------- | ---------------------------------------- |
| `APP_NAME`   | `highchat`  | `highchat`       | UI title/labels/initial and auth appName |
| `APP_DOMAIN` | blank       | `highchat.space` | Cloud Worker custom domain/auth origin   |

The name must be trimmed, printable, nonblank and at most 80 characters. A domain
must be a lowercase hostname without scheme, path, port or wildcard. Blank means
no managed domain declaration; it never means detach existing domains.

Cloud auth derives `https://APP_DOMAIN`. Existing `AUTH_BASE_URL` is an optional
explicit override and must agree with a configured domain. Without either, auth
keeps its existing request-origin behavior. Local mode ignores the domain and
custom auth origin; it always uses localhost/same-origin application auth.
Keep provider credentials out of browser code and public build variables.

## How values reach the app

`@highchat/config/public` owns schemas/pure validation. The Node-only stage loader
is separate at `@highchat/config/stage`; browser code must never import it.
Root `pnpm build` resolves the injected public values before Turbo calculates
hashes. Vite receives only the public name as a JSON constant and HTML-escaped
document title. UI consumers import `apps/web/src/lib/app-config.ts`, not
independent env reads. The Worker receives the same name through Config bindings;
auth uses its appName. No config endpoint, boot fetch or runtime rebranding
service exists.

`pnpm build` and direct Vite commands default to dev, regardless of Vite production
mode or NODE_ENV. `pnpm build:prod` (or
`APP_STAGE=prod doppler run -p effect-boilerplate -c prd -- pnpm build`) selects
prod for an offline build. `doppler run` values are authoritative; direct Vite
commands also accept explicit public APP_NAME/APP_DOMAIN environment overrides.
Turbo hashes these public fields and the stage selection.

PR/main checks receive no cloud credentials and use the shared build defaults;
there is no production configuration file to reconstruct. Configure
`APP_NAME`/`APP_DOMAIN` in the Doppler `prd` config for a real production build.

A name change requires restarting local Worker/Vite, or rebuilding and redeploying
cloud assets/Worker. It does not require editing components or package manifests.
Do not rebuild while the local Worker is serving the old hashed assets.

## Static code identity versus persistent identity

The repository package name is `highchat`; workspace packages use `@highchat/*`.
Imports, lint boundary patterns, Docker package paths, bundling filters and docs
are static code, not runtime .env substitutions. They do not follow APP_NAME.
The hosted GitHub repository name and checkout directory are unchanged. Do not
move into or modify the unrelated Highchat checkout under Documents.

Keep the legacy ServiceStarter Alchemy stack/dev Gateway, D1/R2/DO resource IDs,
BetterAuthSecret/migration IDs, cookie names, Docker labels/image tag and theme
storage/event identifiers stable. They identify data or ownership, not branding.
Changing APP_NAME/APP_DOMAIN does not migrate or delete any of them.

## Domain rollout is separate from code changes

The Worker uses Alchemy `domain` for a configured cloud hostname. R2 bucket
`domains` arrays stay private and unrelated. No Wrangler deployment is added.
No domain is attached by local mode or an offline build. A cloud plan may contact
shared state; deployment requires reviewing the plan and explicit approval.

Before attaching highchat.space, verify the intended Cloudflare account/active
zone, current hostname ownership, DNS conflicts and required token permissions.
Do not overwrite another site or adopt an existing attachment silently. No www
alias, redirect or access-policy change is implied. A blank config omits domain
management; intentional detachment needs a separately approved cloud change.

The same-origin frontend, API and files use the new hostname.
Cookies/localStorage from an older hostname do not transfer automatically: expect
sign-in and origin-local preferences again, without deleting application users.
After approved rollout, verify DNS/TLS, static assets, auth/origin checks, existing
chats/files behavior. No live acceptance follows merely from passing source
lint/build checks.
