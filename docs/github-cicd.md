# GitHub CI

## Branch workflow

1. Work on a feature branch and run `pnpm lint` and `pnpm build` locally.
2. Open a PR into `main`; merge only after the `Check` job succeeds.
3. Open a PR from tested `main` into `prod` and merge it.

PRs targeting main/prod and pushes to either run a frozen install, audit, lint and
build. There is no deploy job and no cloud credential in this workflow: the runtime
is a local Node process, and the repository owns no deployment configuration.

## What CI proves

`Check` proves formatting, configuration validation, linting, the 200-line rule,
Effect diagnostics, all workspace typechecks and the production build. It does not
prove that Clerk sign-in works, that a model provider answers, or that a deployment
succeeds, because none of those run in CI.

## One-time repository setup

1. Keep `main` as the default branch and create `prod` from tested main.
2. Protect main and prod: require PRs and the `Check` status, disallow force pushes,
   and restrict direct prod pushes.

No environment secrets are needed by this workflow. Provider credentials belong to
whichever machine runs the server, never to GitHub.

## Private environment configuration

Stage values live in Doppler project `effect-boilerplate` (`dev` and `prd`), not
in the repository. `pnpm lint` validates the active configuration, including a
missing shared key when Doppler injected it, and otherwise validates the
checked-in defaults. The shared public keys are `APP_NAME`, `APP_DOMAIN`,
`AUTH_BASE_URL`, `CHAT_MODEL_ALLOWLIST`, `CHAT_HOST_URL` and
`CLERK_PUBLISHABLE_KEY`.

`CLERK_SECRET_KEY`, `OPENROUTER_API_KEY` and the Pi host token are process
environment values on the machine that runs the server. CI holds no Doppler token
and builds with the shared defaults.

## Deployments

There is none. Running the application is `pnpm dev` locally or `pnpm start` on a
machine you own. Adding a deployment target is a separate decision that must bring
its own configuration, credential handling and rollback plan; this repository does
not ship one and no deployment was performed as part of this change.
