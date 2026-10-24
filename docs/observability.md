# Backend observability

Alchemy owns the settings in `apps/api/src/options.ts`. Deploying the stack
configures Workers Logs and native tracing; there is no separate Wrangler deploy
or external collector. These features are not live-verified yet.

## Signals and sampling

- Native Worker metrics: request counts, runtime outcomes, CPU and wall time.
  D1 also has its own metrics. No custom metric exporter is installed.
- Workers Logs: persisted invocation logs plus structured application logs,
  with 100% head sampling initially in dev and prod.
- Workers Traces: 100% in both dev and prod. `Cloudflare.Telemetry()` connects
  Effect spans to native handler/D1/fetch tracing. Fixed application spans are
  `request.handle`, `auth.handle` and `api.handle`.
- The existing compatibility date supports the native tracing integration.

The native metrics do not equate runtime success with HTTP success: handled HTTP
500 responses may still be successful runtime invocations. Query the completion
log's `status` for HTTP errors. Wall time includes background work; it is not
response latency. Our `duration_ms` measures handler completion, not streamed
body delivery or the visitor's network latency.

Sampling traces can omit failed requests. Lowering log head sampling also drops
errors from unsampled requests. Native logs and traces have seven-day paid
retention; they are not an immutable audit record. Invocation logs and completion
logs are separate billable events. Review account usage before increasing volume
and consult [current pricing](https://developers.cloudflare.com/observability/pricing/).

## Structured request logs

`apps/api/src/observability.ts` wraps the common fetch boundary, including auth
and Access-denied responses. A `request.complete` record contains:

- `timestamp`, `level`, `event`, `service`, `stage`, `release`;
- generated `request_id`, bounded `method` and `route` categories;
- handler `status`, `outcome` (`response` or effect `failure`), `duration_ms`.

The response carries the same generated `x-request-id`. Incoming request IDs are
ignored. Normal headers, cookies, bodies and streams are not consumed or replaced
for logging. Alchemy's standard `Http.safeHttpEffect` converts failed handlers
using the same response/error-reporting policy as its outer adapter, before
instrumentation. Converted error responses also receive an ID and their actual
HTTP status is logged; there is no bespoke exception-to-response mapping.
Converted client aborts log 499; converted server interruptions log 503. An
interruption escaping conversion logs a diagnostic 499 without creating a
response. Failures after the handler (for example while streaming) need native
platform diagnostics and may not appear as a failed completion record.

`release` is the validated GitHub commit SHA during Actions deployments; without
a valid SHA it is `local-<startup stamp>` for local runs and `manual-<stamp>`
otherwise. A stamp marks the startup, not a versioned build; the inspected
Docker image ID remains the local Office build identity. Metadata is bound by
Alchemy, not copied from user-supplied headers. No stage env-file keys were
added.

## Internal errors and failure diagnostics

Diagnostics must answer four questions: which check/dependency failed, which
request/task/original operation it belongs to, whether its outcome is known or
uncertain, and where its canonical record can actually be found without private
data. Request completion stays context-rich; per-check INFO noise is not useful.

Internal services retain original native Error/Effect Cause chains and useful
domain classifications. `@starter/diagnostics.withCause` attaches causes after
tagged-error construction, outside schema fields and serialized constructor data.
Do not reconstruct a known local error into a public-shaped instance internally.
Only outward HTTP/tool/native-client encoders choose safe user-facing errors.

`application.failure` includes fixed `component`, `operation`, optional `reason`,
allowlisted error tags/codes/provider status and bounded nested cause summaries.
Only repository source locations may be extracted from stacks; foreign messages
and full stacks are never emitted. Existing request/operation/task/call/submission
IDs correlate failures without carrying owner/session credentials or authority.
Native causes remain intact in memory; log projection is not error propagation.

Effect ErrorReporter observes Alchemy's existing HTTP/RPC failure boundary before
safe response encoding, using generated request-scoped correlation. The logger
also retains safe cause summaries from framework failure logs. Expected domain
rejections and interruptions are not automatically reported as crashes. Typed
handler/tool mappers and intentionally recovered failures report at their actual
handling owner before returning a safe response or recovery result. Effect owners
use `reportFailureEffect` to inherit the generated request's existing annotations;
Promise/Node owners use `reportFailure` with their existing operation/task IDs.
No mutable global context or caller-supplied request identity is introduced.

Effect HttpApiBuilder also reports typed failures automatically. Ordinary public
domain rejections are excluded by a finite class-based policy, not by arbitrary
status/tag text; defects and unexpected 503s remain reportable. After an outward
owner explicitly reports the original failure, `reportedFailure` marks only its
final public facade with native ErrorReporter.ignore outside constructor/schema
data, preventing a second generic failure event. Never use it to hide an
unreported internal service failure. Mixed Causes retain other real failures.

Lifecycle evidence uses `reportEvent`/`reportEventEffect`, which emit finite
`application.phase` records by default and `application.complete` for terminal
outcomes. `withDiagnostic(error, fixedReason)` attaches an app-owned reason
without touching the native error or serialized schemas; `diagnosticMetadata`
reads only `OBS_SERVICE`/`OBS_STAGE`/`OBS_RELEASE`. Phase and reason labels are
fixed application strings; first-failure causes stay intact while separate
cleanup/recovery records carry their own outcome.

Native chat Durable Objects, Node Office processes, fixed jobs and detached work
do not automatically inherit the API Effect logger. Their handling/recovery
owners call the same bounded reporting helper. Private bridges report at origin
and join existing operation/call identities rather than serializing raw errors.
Do not log at every propagation layer, retry to obtain logs, or treat missing
receipts/logs as proof no external I/O occurred. A failed cleanup must not replace
the primary cause or turn a known successful paid operation into retry permission.

Use ERROR for actual failures, WARN for successfully recovered issues, and INFO
for ordinary denial/cancellation/completion. Recovery records default to WARN;
cleanup defaults to ERROR unless the owner knows the business outcome succeeded
and explicitly chooses WARN. An uncertain write or unconfirmed physical teardown
is not a harmless warning merely because its error was caught.

## Privacy policy

- Application logs never forward request/response bodies, raw paths or query
  strings, headers, passwords, tokens, email addresses, IPs or session objects.
- Request-time framework Effect logs project original causes into safe structured
  diagnostics; arbitrary messages/annotations and raw foreign errors are not
  exported. `application.log` remains for non-failure framework events. Only
  approved request-correlation metadata is read from log annotations.
  Isolate-initialization diagnostics still use Alchemy's platform logger and
  require separate review. Never enable an unrestricted pretty/JSON error dump.
- Better Auth's raw logger is disabled; its HTTP outcomes remain observable at
  the common boundary. Expected login failures are not treated as runtime crashes.
- Native `redactQueryString` is enabled. Effect HTTP's automatic tracing is
  disabled because it independently attaches raw URLs and headers. Native
  platform tracing and our fixed-name Effect spans remain enabled.
- Use the shared reporting helper, not direct console dumps or raw span
  attributes; those bypass this application policy. Native automatic URL/SQL/error metadata still requires
  review. Query redaction does not sanitize SQL literals or sensitive URL paths.
- Avoid secrets in URLs and SQL literals; use parameter binding. Inspect native
  traces/logs with synthetic canaries before production rollout.

## Local delivery and verification limits

`pnpm dev` inherits stdout/stderr continuously for the Worker; `pnpm dev:web` does
the same for Vite. Keep those streams attached or capture only the structured safe
diagnostic records; do not drop everything after readiness. An old
session-specific launcher wrapper did exactly that, so its lack of request output
is not evidence that the application emitted nothing. Frontend HMR updates browser
code but cannot repair a running no-watch Worker; restart `pnpm dev` for backend
changes and preserve local state/data.

Lint/build/source review do not prove real request, native job or provider
logging delivery. Use synthetic, nonsecret failures and verify each actual
runtime path before claiming end-to-end acceptance. Never replay an uncertain
upload or incur paid inference simply to obtain a better error record.

## Canonical sinks, correlation, retention, and coverage limits

Local lane: inherited stdout/stderr of `pnpm dev`/`pnpm dev:web`; find a record by its
generated `x-request-id` or existing operation/task/call/submission ID. Browser
callers retain the validated `x-request-id` plus safe operation/status as a
copyable reference and report fixed phase/reason records to the local browser
console only (T17 local capture; runtime acceptance still unverified). No
external browser collector is provisioned.
Cloud lane: Workers Logs (persisted invocation plus structured application
logs) and Workers Traces, both 100% head sampling initially with seven-day
paid retention; they are billable, separate events, and not an immutable audit
record. Correlate by `request_id`/operation IDs plus service/stage/release;
concurrent requests never share an ID. No saved dashboards, alert destinations,
browser error reporting, Web Analytics, Observability MCP, or external exports
are provisioned by this code. Privileged admin/OTA/billing-replay audit history
is a deferred decision (O05): no new audit store is added and ordinary denials
are not blanket-logged as errors. Email/Slack adapters are opt-in and
unconsumed (O06): validate the chosen adapter when actually enabled.
Source-only status (O01-O04): lint/build/source review do not prove per-lane
delivery, native job-log retention, startup/native automatic metadata privacy,
or versioned local build identity beyond the per-startup `local-<stamp>`
marker. Cloud and provider paths are explicitly unverified without deployment
authorization.

## User-owned live verification

1. Run `pnpm plan:dev`, review it, then `pnpm deploy:dev` with approved credentials.
2. Open the allowed dev site. Exercise health, signup/signin, `/api/me` and
   signout. Confirm cookies/session/Access behavior is unchanged.
3. Inspect a response's `x-request-id`; find its `request.complete` log in the
   Worker's Observability tab. Check service/stage/release/status/duration fields.
4. Find nested request/auth/API and native D1 spans. Verify concurrent requests
   have different IDs and do not share context. Dev records all traces.
5. Use only synthetic nonsecret markers to inspect query/body/header/error
   leakage in all custom/native records. Do not use actual credentials as probes.
6. Safely exercise a failed handler and interruption in dev; verify failure
   logging without changing responses. Do not break production resources.
7. Review the production plan for 100% traces and 100% logs before merging
   to prod. Review retention/volume/billing and privacy before enabling traffic.

Alert destinations, saved dashboards, external browser error reporting, Web Analytics,
Observability MCP and external exports require separate setup; this code does
not provision them. No Cloudflare account changes were made during implementation.
