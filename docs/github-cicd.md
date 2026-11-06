# GitHub CI/CD with Alchemy

## Branch workflow

1. Work on a feature branch; run `pnpm deploy:dev` locally and test its URL.
2. Open a PR into `main`; merge only after the `Check` job succeeds.
3. Open a PR from tested `main` into `prod` and merge it.
4. A push to `prod` runs checks, then `pnpm deploy:prod` in GitHub Actions.

PRs targeting main/prod and pushes to either run frozen install, audit, lint,
and build. PRs and main pushes never deploy or receive Cloudflare credentials.
Dev testing is a manual process; CI does not prove it happened.

`.github/workflows/ci.yml` is the only automatic deployment owner. Do not also
connect Cloudflare Workers Builds or separately deploy the same Worker with Wrangler.
Production deploys are serialized and do not cancel an in-progress deployment;
GitHub may replace older queued runs with newer ones. After acquiring the deploy
slot, a branch-head check skips superseded commits to prevent stale rollbacks.
Avoid concurrent manual
production deploys and do not manually cancel an infrastructure update casually.

## One-time repository setup

Configure repository environments and branch protection before enabling production deployment:

1. Keep `main` as the default branch and create `prod` from tested main.
2. In GitHub **Settings → Environments**, create **production**.
3. Restrict that environment to deployments from the `prod` branch only.
4. Add these **environment secrets** (not variables or committed files):
   - `CLOUDFLARE_ACCOUNT_ID`: the production Cloudflare account.
   - `CLOUDFLARE_API_TOKEN`: an account-scoped CI deployment token.
5. Set public production variables `APP_NAME=highchat` and `APP_DOMAIN=highchat.space`
   (or your intended name/hostname). A blank `APP_DOMAIN` leaves domains unmanaged.
   `AUTH_BASE_URL` may remain blank to derive the domain HTTPS origin; an explicit
   value must match it and have no path, query, credentials or trailing slash.
6. For production Pi chat, optionally set nonsecret environment variable
   `CHAT_GATEWAY_ID` to a separate production gateway and `CHAT_MODEL_ALLOWLIST`
   to a JSON array of exact enabled catalog IDs. Blank configuration disables
   inference; never use dev resources. Provision enabled vendors' default BYOK
   aliases securely in Cloudflare, not GitHub/stage env. Audio stays disabled in prod.
7. Protect main and prod: require PRs and the `Check` status, disallow force pushes,
   and restrict direct prod pushes. Reviewers for production environment approvals
   are optional: enable them if deployment should pause for human approval.

Environment secrets/protection availability depends on your GitHub plan; private
repositories may require a paid plan. Verify availability before enabling prod.

GitHub's contents permission is read-only; checkout does not persist its token.
Cloudflare secrets are passed only to the deploy step, not install/build-only PR
jobs or package lifecycle scripts. Trusted prod code still runs with deployment
credentials; branch protection and environment restrictions must be configured.

## Cloudflare credentials and state

Use a production-only account/profile locally, preferably separate from dev.
The CI token needs the permissions used by this stack: Workers Scripts,
D1, account settings/subdomain access, and the shared state's Secrets Store
and edge-preview authentication. Use the [Alchemy CI guide](https://alchemy.run/environments/ci/)
and scope the token to the intended account; a generic Workers-only token may
not cover D1, private chat-file R2 bucket management or state access. Do not grant API-token-creation permissions to
normal deployment CI. Additional stack resources may require more permissions.

Before enabling the workflow, bootstrap the **production account's** encrypted
state store once locally with approved credentials:

```sh
pnpm --filter @highchat/infra exec alchemy provider cloudflare bootstrap --profile prod
```

Keep the remote state store compatible with the pinned Alchemy version. CI fails
if it is missing/outdated; this workflow does not pass `--yes` or automatically
bootstrap/upgrade it. Do not delete state to make an error disappear.

Alchemy reads Cloudflare credentials from the CI environment, not local profiles.
The script's `--profile prod` selects the name; CI needs no copied profile files.
The existing stack already uses shared Cloudflare state, not ephemeral local state.

## Private environment configuration

Env files remain ignored by Git. Install creates blank/default dev/prod files.
On a prod push only, `scripts/configure-ci.mjs` reconstructs the runner's
`.env.prod` with the same keys, `ALLOW_PRODUCTION=true`, blank
Access allowlist (prod has no developer wall), the optional auth origin and
nonsecret `APP_NAME`, `APP_DOMAIN`, `CHAT_GATEWAY_ID` and `CHAT_MODEL_ALLOWLIST`.
The deployment launcher selects prod before lint/build and passes public branding
into Turbo hashing; the earlier unprivileged Check job uses default dev values.
Production speech allowlists stay blank and no audio token/profile is loaded.
This does not change your local file. The explicit env file overrides shell
values; the production opt-in must be written into that file.

Update the shared defaults and this CI adapter together when adding common keys.
Do not upload env files, profiles, `.alchemy` state, or secrets as build artifacts.
First live deployment and auth/session checks are user-owned; no production
workflow or cloud deployment was executed as part of this repository change.
