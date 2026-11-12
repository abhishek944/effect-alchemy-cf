# Runtime, storage and typed errors

## One Node process

`apps/api/src/server.ts` is the only server entry. It creates a `node:http` server
through `NodeHttpServer`, serves the built `apps/web/dist` assets, and answers the
same `/api/*` routes the application always had. There is no edge runtime, no
infrastructure-as-code provider, no Durable Object and no deployment configuration.

`apps/chat-host` stays a separate private Node process on `127.0.0.1:1338`. It owns
real Pi SDK sessions; the API owns authenticated outbound model and SDK-tool HTTP,
while the credential-free host owns the agent loop.

## Chat objects

Two object classes keep their previous responsibilities: `ChatCatalog` owns one
owner's preferences, profile, themes, files index, images, skills and speech state;
`ChatConversation` owns one chat's transcript, accounting, submission and event
stream, and is still the private authority for an accepted operation.

`apps/api/src/chat-object.ts` provides them:

- `ChatObject` is the base class. Only `onRequest` exists, as before. `scheduleEvery`
  replaces the Durable Object alarm with an unref'd interval, so a sweep never keeps
  the process alive.
- `ChatObjectContext` exposes `storage` (`sql`, key/value, `transactionSync`) and `id`
  (`name`, `toString()`), the only Durable Object members the code used.
- `ChatObjectRegistry` gives one instance and one promise-chain queue per key. That
  queue is the local replacement for Durable Object single-writer semantics: requests
  for one chat serialize, requests for different chats run concurrently.

The queue holds for one process only. Two processes pointed at the same storage
directory are not serialized and are not a supported configuration.

## Storage

`packages/platform` owns every storage adapter:

- `SqlClient` (`src/sql.ts`) runs `node:sqlite` `DatabaseSync` and exposes a cursor
  with `toArray()`, `one()` and `rowsWritten`, so the existing store modules keep
  their call shape. `transactionSync` uses `BEGIN IMMEDIATE` and nested savepoints.
- `KeyValueStore` (`src/kv.ts`) is a JSON table in the same database.
- `ObjectStore` (`src/objects.ts`) is a directory of content-addressed byte files
  with atomically replaced sidecar metadata. It implements the R2 subset the file,
  profile and skills code already used: `get`, `head`, `put`, `delete`, `list`,
  including `sha256` verification and the create-only `onlyIf` precondition.
  A conditional create on an existing key returns `null` and never throws, so a
  replayed upload is resolved by re-reading and verifying the object; a digest
  mismatch still fails loudly. Writes and deletes for one key are serialized in
  process, and because metadata names the exact digest-named byte file, a reader
  can never pair new metadata with old bytes. Cross-process writes to one directory
  are not serialized and are not a supported configuration.

Layout under `CHAT_STORAGE_DIR` (default `var/storage`): `chat/<sha256(key)>.sqlite`
per object and `objects/` for bytes. Deleting the directory resets local data.

## Identity

`packages/auth/src/identity.ts` is the only identity boundary. It wraps
`@clerk/backend` `createClerkClient` and `authenticateRequest({ acceptsToken:
"session_token", authorizedParties })`, then reads the live user record once per
request. `Unauthenticated` (401) and `IdentityUnavailable` (503) are distinct: a
Clerk outage never becomes a denial, and a signed-out request never becomes an
outage. Admin authority is `publicMetadata.role === "admin"`, so a dashboard change
applies on the next request.

`apps/api/src/native-auth.ts` is the same boundary for the multipart, binary and
streaming routes, which answer with a response rather than a typed error.

## Model transport

`apps/api/src/chat-model-transport.ts` returns a pi-ai provider targeting only
LiteLLM with explicit server credentials. Gateway discovery controls availability;
pinned native Pi metadata enriches exact compatible canonical mappings, not another
manual allowlist. Replies, follow-up model calls, compaction and titles use the
accepted owner's unchanged verified Clerk UID as customer identity. Missing inference configuration/discovery refuses
new work before admission; saved chats remain readable and no direct provider is a
fallback. API-owned image/classifier SDK tools share this gateway; voice stays separate. See [gateway setup](chat-gateway.md)
and [usage authority](chat-models-usage.md) for exact prerequisites and failure modes.

The application origin used for same-origin checks and absolute attachment URLs is
the platform request URL validated against server configuration: the configured
public origin when the stage has one, otherwise loopback hosts only. An unvalidated
`Host` header is never trusted, and a relative request URL is never parsed bare.

Image generation uses the existing public SDK only for discovered supported gateway
mappings. Missing configuration refuses before reservation. Optional classification
uses the public Decisions SDK with explicit per-call credentials and no file access.

## Typed errors

`packages/chat-contract/src/errors.ts` owns the tag union, the response body schema
and `statusOfTag`. The server keeps `httpApiStatus` as the single source of truth for
a tag's status.

`apps/web/src/lib/api-error.ts` owns one `ApiError` (`tag`, `status`, `requestId`,
`reference`) and the `tag → copy` table. A server tag is authoritative: the client
derives the status from the tag, so a proxy that rewrites the status cannot mislead
the UI. A response with no recognizable tag falls back to status-only copy, and a
network failure stays distinct from a server error.

Failure ownership is unchanged: 401/403/409 are domain outcomes and are never
reported as failures; 503 and defects are reported once at the boundary that saw the
cause; the client never invents a success.
