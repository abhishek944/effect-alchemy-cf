import { Effect, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { ImageApplicationOrigin } from "./chat-image-response-schema.ts";
import { ChatUnavailable } from "./chat-model.ts";

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

/** Loopback only, so a local process never accepts an arbitrary Host header. */
const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "[::1]", "::1"];

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The one configured public origin, or null when the stage has none. */
const configuredOrigin = (env: Readonly<Record<string, unknown>>): string | null => {
  const base = text(env.AUTH_BASE_URL);
  if (base.length > 0) {
    const url = URL.canParse(base) ? new URL(base) : null;
    return url?.protocol === "https:" && url.origin === base ? url.origin : null;
  }
  const domain = text(env.APP_DOMAIN).toLowerCase();
  return HOSTNAME.test(domain) ? `https://${domain}` : null;
};

/**
 * Validates an untrusted request origin against server-controlled policy: the
 * configured public origin when the stage has one, otherwise loopback only.
 * The Host header is only ever read through this check.
 */
export const applicationOriginAllowed = (
  env: Readonly<Record<string, unknown>>,
  origin: string,
): boolean => {
  const configured = configuredOrigin(env);
  if (configured !== null) return origin === configured;
  const url = URL.canParse(origin) ? new URL(origin) : null;
  if (url === null) return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return LOOPBACK_HOSTS.includes(url.hostname.toLowerCase());
};

/**
 * Call after authentication. The origin is the validated platform request URL,
 * checked against the caller-supplied server configuration.
 */
export const publicApplicationOrigin = (env: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const web = yield* HttpServerRequest.toWeb(request).pipe(
      Effect.mapError(() => new ChatUnavailable()),
    );
    const origin = yield* Effect.try({
      try: () => new URL(web.url).origin,
      catch: () => new ChatUnavailable(),
    });
    if (!applicationOriginAllowed(env, origin)) return yield* Effect.fail(new ChatUnavailable());
    return yield* Schema.decodeUnknownEffect(ImageApplicationOrigin)(origin).pipe(
      Effect.mapError(() => new ChatUnavailable()),
    );
  });

/** Trusted API-to-conversation transport only; never browser-selected. */
export const conversationApplicationOrigin = (request: Request): string | null => {
  const value = request.headers.get("x-chat-application-origin");
  return Schema.is(ImageApplicationOrigin)(value) ? value : null;
};
