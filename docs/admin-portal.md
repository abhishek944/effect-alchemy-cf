# Admin portal

The admin UI has its own origin. Locally `pnpm dev:web` serves it at
**http://localhost:5175**, where `/` is the portal and `/users` is the Users
section; the main UI stays at http://localhost:5173. The main site has no
`/admin` route. The portal is the same React source and Node API, selected by the
Vite `admin` mode and built for its own origin. This repository configures only
that local admin origin; production hosting for an admin build is not defined
here. The portal reads the same Clerk session as the main UI. It includes a
responsive sidebar, a Users view, exact-email lookup and user/admin role controls.
There is no email delivery service or router dependency.

## Sign-in

The portal signs in at its own root through the public sign-in page: one component,
the same shader and copy as the main UI. It is sign-in only, so the page renders no
account-creation switch and Clerk's own "Don't have an account? Sign up" action is
hidden on this instance; the rest of the form, password recovery, footer branding and
help/terms/privacy links stay. Only the destinations differ, so the admin origin still
links home to the main site, and public sign-up is unchanged there. The page itself
never explains how a role is granted, and a denial only says the account lacks admin
access; granting `{"role": "admin"}` stays an operator task in the Clerk dashboard.

## Access model

There is no in-app admin bootstrap. Clerk creates accounts and owns the session;
the server decides authority from one value: `publicMetadata.role === "admin"`.

- Grant or revoke the role in the Clerk dashboard: user → Metadata → Public, set
  `{"role": "admin"}` (or remove the key).
- Every admin request re-reads the live Clerk user record, so a change applies on the
  next request rather than on the next session refresh.
- Admin APIs answer 401 with no verified session, 403 for a non-admin account, and a
  reported 503 `AuthenticationUnavailable` when Clerk itself cannot answer. An
  outage is never reported as a denial.
- Mutations require a same-origin request. An operator cannot remove their own admin
  role; another admin can. Signing out of the portal signs out the application on
  that browser.
- The portal can search one exact email and change a user's role; it cannot create
  accounts, reset passwords or list all users.

## First admin

1. Configure a Clerk instance and sign in once with the account that should be the
   first administrator.
2. In the Clerk dashboard open that user, edit its public metadata, and set
   `{"role": "admin"}`.
3. Reload the admin root (`/`); the portal now renders. No token, SQL migration or
   offline helper is involved, and no helper script exists.

## API

| Method | Path                        | Result                                           |
| ------ | --------------------------- | ------------------------------------------------ |
| GET    | `/api/admin/me`             | Current admin id, name, email and role           |
| POST   | `/api/admin/users/search`   | `{email}` returns `{user: details or null}`      |
| PATCH  | `/api/admin/users/:id/role` | `{role: "user" or "admin"}` returns `{ok: true}` |

These API paths are unchanged by the admin-origin migration.

User details contain id, name, email, role, emailVerified, createdAt and updatedAt.
Passwords, provider credentials, session tokens and verification values are never
returned. Lookup uses an exact normalized email; it does not list all users or
support substring search. POST keeps the searched email out of URL logs. The Clerk
Backend API adapter owns the queries; API handlers own validation and authorization.
Transient Clerk failures return 503 without exposing internal diagnostics.

## User-owned acceptance checks

These are live checks for the user. They were not run here: no Clerk instance or
dev keys were configured, so sign-in, cookie transport and admin claims are
compile-verified only.

- `/` shows the Clerk sign-in form with no account-creation control; an existing
  admin account can sign in and out.
- Locally, http://localhost:5175 opens the admin portal at `/`, and `/users` opens
  the Users section; the Clerk session is shared with the main UI at
  http://localhost:5173.
- The main origin no longer serves admin UI at `/admin`.
- Anonymous admin `/` shows sign-in; `/api/admin/me` returns 401.
- A non-admin account gets 403 from the admin APIs.
- Setting `publicMetadata.role = "admin"` in Clerk grants access on the next reload.
- Removing the role denies the next admin request with 403.
- Self-demotion is blocked; invalid roles and malformed email payloads are rejected.
- Role writes and search from a different origin fail.
- `/api` returns a typed 503 `AuthenticationUnavailable` when Clerk is unreachable.
