# Admin portal

Open `/admin` (or `/admin/users`). The portal shares the existing frontend,
Worker, D1 database and Better Auth cookie session. It includes a responsive
sidebar, a Users view, exact-email lookup and user/admin role controls.
There is no separate frontend deployment, email delivery service or router dependency.

## Bloom reference and access model

The reference is `Documents/bloom/bloom-new/bloom-turbo`:
`apps/backend-go/internal/api/admin/ota/store.go`, `admin/session/login.go`,
`admin/users/types.go` and `apps/admin/src/components/loginPage.tsx`.
Bloom uses **OTA (one-time access)**, not an emailed OTP: an expiring,
single-use token bootstraps admin access, then ADMIN-role accounts use passwords.

Here, a 30-minute OTA token is bound to an existing account. Redeeming it grants
that account the `admin` role and sets a Better Auth HTTP-only session cookie.
Unlike Bloom's synthetic bootstrap identity and browser-stored bearer session,
this retains a real account identity and reuses the existing cookie security.
The token is stored only as a SHA-256 hash in Better Auth's `verification` table;
Better Auth's atomic consume prevents replay, including concurrent redemption.
Invalid, expired and used tokens are rejected. The OTA endpoint has a five-per-minute
rate limit in cloud stages; the existing local-development limiter remains disabled.

Roles are `user` (default) and `admin`. Signup and profile updates cannot set roles.
Every admin API request loads the current session and role from D1; role removal
therefore takes effect on the next request, even with an existing cookie.
Role updates and lookup require a same-origin request. Admin APIs return 401 for
no session and 403 for a non-admin role or invalid mutation origin. A failed
session or role read is a reported 503 `AuthenticationUnavailable`, never a
denial: the final auth handler keeps the original failure in memory and returns
only the safe status. Better Auth answers its own API errors with responses before
Effect sees them, so its supported `onAPIError` hook reports unexpected internal
or unhandled failures with fixed labels and replaces them with a fixed safe 500;
expected login, validation and session outcomes remain ordinary 4xx responses.
That hook has no request ID.
An operator cannot remove their own admin role; another admin can remove it.
Existing normal application sessions are valid for `/admin` only with an admin role.
Admin signout also signs out the main application on this browser.

## First admin: offline token provisioning

This is a privileged database operation. No public token-generation endpoint exists.
Review the target stage and SQL before applying; never use production resources for dev.
The helper only creates SQL and prints a token. It does not connect to or change a database.

1. Review the auth migration plan. Adding `user.role` is an additive Better Auth
   schema migration, managed by the existing Alchemy auth migration action.
   Apply through your approved local/deployment workflow; no deployment is part of
   this code change. Existing accounts must receive the default `user` role.
2. Create a normal account in the intended local/dev stage and sign out.
3. Generate SQL in an ignored scratch folder:

   ```sh
   mkdir -p var/admin-portal
   node scripts/admin-ota.mjs admin@example.com var/admin-portal/bootstrap.sql
   ```

4. Keep the printed token private. Review the SQL and manually apply it to that
   stage's AuthDatabase with your approved D1 tooling. Confirm exactly one row is
   returned; no row means the account was not found. The file contains a hash, not
   the plaintext token. The helper refuses to overwrite an existing file.
5. Within 30 minutes of generation, open `/admin`, select One-time access, and
   paste the token. The account becomes an admin and the portal opens.
6. For subsequent logins, use the account's email and password. Admins can search
   another existing account and grant its admin role without provisioning another token.

Tokens are credentials. Do not commit, share in logs, or retain plaintext tokens.
For recovery, an authorized operator can provision a new token for an existing
account using the same reviewed procedure. Do not make OTA generation public.
No new stage env keys or email-provider credentials are required.

## API

| Method | Path                        | Result                                              |
| ------ | --------------------------- | --------------------------------------------------- |
| POST   | `/api/auth/admin-ota-login` | `{token}` consumes OTA, grants role and sets cookie |
| GET    | `/api/admin/me`             | Current admin id, name, email and role              |
| POST   | `/api/admin/users/search`   | `{email}` returns `{user: details or null}`         |
| PATCH  | `/api/admin/users/:id/role` | `{role: "user" or "admin"}` returns `{ok: true}`    |

User details contain id, name, email, role, emailVerified, createdAt and updatedAt.
Passwords, account-provider credentials, session tokens and verification values
are never returned. Lookup uses an exact normalized email; it does not list all
users or support substring search. POST keeps the searched email out of URL logs.
The database adapter owns queries; API handlers own validation and authorization.
Transient auth/database failures return 503 without exposing internal diagnostics.

## User-owned acceptance checks

- `/` still supports normal signup, signin and signout.
- Anonymous `/admin` shows login; `/api/admin/me` returns 401.
- A normal user's email/password cannot access admin APIs (403).
- First OTA redemption grants access; reuse, expiry and malformed values fail.
- Users search displays the expected details, or a clear empty result.
- Grant an existing user `admin`; that user can now use password login at `/admin`.
- Remove another user's admin role; their next admin request fails with 403.
- Self-demotion is blocked; invalid roles and malformed email payloads are rejected.
- Role writes and search from a different origin fail; signup cannot inject admin role.
- Logout and refresh return to login. Check loading/errors and mobile navigation.
- Confirm local, cloud dev and prod users/tokens remain isolated.

These are live checks for the user to run after the approved database/schema setup.
Unit tests and live browser testing are not part of this change.
