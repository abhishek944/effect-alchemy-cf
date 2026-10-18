import { Effect, Redacted } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { IntegrationError, type IntegrationProvider } from "./error.ts";

export const failure = (
  provider: IntegrationProvider,
  kind: IntegrationError["kind"],
  status: number | null = null,
  retryAfterSeconds: number | null = null,
  code: string | null = null,
): IntegrationError => new IntegrationError({ provider, kind, status, retryAfterSeconds, code });

export const validateCredential = (provider: IntegrationProvider, token: Redacted.Redacted) =>
  Effect.filterOrFail(
    Effect.succeed(token),
    (value) => /^[\x21-\x7e]+$/.test(Redacted.value(value)),
    () => failure(provider, "InvalidConfiguration"),
  );

const retryAfter = (value: string | undefined): number | null => {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : null;
};

/** One request, fixed provider URL, no retries. Timeout covers reading JSON too. */
export const postJson = (
  client: HttpClient.HttpClient,
  provider: IntegrationProvider,
  token: Redacted.Redacted,
  url: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.bodyJson(body),
      Effect.mapError(() => failure(provider, "InvalidInput")),
    );
    const response = yield* HttpClient.withScope(client)
      .execute(request)
      .pipe(Effect.mapError(() => failure(provider, "Transport")));
    const delay = retryAfter(response.headers["retry-after"]);
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(failure(provider, "Http", response.status, delay));
    }
    const json = yield* response.json.pipe(
      Effect.mapError(() => failure(provider, "InvalidResponse", response.status, delay)),
    );
    return { body: json, status: response.status, retryAfterSeconds: delay };
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: "15 seconds",
      orElse: () => Effect.fail(failure(provider, "Timeout")),
    }),
    // HTTP tracing otherwise records headers; provider errors must not retain requests.
    Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
  );
