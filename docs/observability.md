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

`release` is the validated GitHub commit SHA during Actions deployments; manual
runs without `GITHUB_SHA` use `unversioned`. Metadata is bound by Alchemy, not
copied from user-supplied headers. No stage env-file keys were added.

## Privacy policy

- Application logs never forward request/response bodies, raw paths or query
  strings, headers, passwords, tokens, email addresses, IPs or session objects.
- Request-time framework Effect logs retain severity/time with generic
  `application.log` events, not arbitrary messages, causes, annotations or stack
  traces. These fields are never formatted by our loggers. Isolate-initialization
  diagnostics still use Alchemy's platform logger and require separate review.
  This is deliberately less diagnostic than unrestricted error dumps.
- Better Auth's raw logger is disabled; its HTTP outcomes remain observable at
  the common boundary. Expected login failures are not treated as runtime crashes.
- Native `redactQueryString` is enabled. Effect HTTP's automatic tracing is
  disabled because it independently attaches raw URLs and headers. Native
  platform tracing and our fixed-name Effect spans remain enabled.
- Do not add direct console dumps or raw span attributes; those bypass this
  application policy. Native automatic URL/SQL/error metadata still requires
  review. Query redaction does not sanitize SQL literals or sensitive URL paths.
- Avoid secrets in URLs and SQL literals; use parameter binding. Inspect native
  traces/logs with synthetic canaries before production rollout.

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

Alert destinations, saved dashboards, browser error reporting, Web Analytics,
Observability MCP and external exports require separate setup; this code does
not provision them. No Cloudflare account changes were made during implementation.
