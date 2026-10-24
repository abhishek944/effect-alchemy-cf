/**
 * Native route for private avatar bytes: upload, read and cancel.
 *
 * Authenticated owner and same-origin mutation are required, bytes are stored
 * under an owner-scoped key derived from the owner catalog, and the only avatar
 * URL is this owner-authenticated endpoint. Nothing here exposes a public URL,
 * a bucket key or a copy for AI.
 */
import type * as cf from "@cloudflare/workers-types";
import { Auth } from "@starter/auth";
import * as Cloudflare from "alchemy/Cloudflare";
import { RuntimeContext } from "alchemy";
import { Cause, Effect, Schema } from "effect";
import { reportFailureEffect } from "@starter/diagnostics";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { ChatNamespaces, doCall } from "./chat-bindings.ts";
import { decodeOption, fail } from "./chat-internal.ts";
import { avatarObjectKey, putAvatarObject, readAvatar } from "./profile-avatar.ts";
import { AvatarRefResponse, AvatarUploadResponse } from "./profile-model.ts";
import { decodeAvatar } from "./profile-upload.ts";

export const PROFILE_PHOTO_PATH = "/api/profile/photo";

export const isProfilePhotoPath = (pathname: string): boolean => pathname === PROFILE_PHOTO_PATH;

const bucketBinding = (value: unknown): value is cf.R2Bucket =>
  typeof value === "object" &&
  value !== null &&
  "get" in value &&
  typeof value.get === "function" &&
  "put" in value &&
  typeof value.put === "function" &&
  "delete" in value &&
  typeof value.delete === "function";

const jsonResponse = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const avatarHeaders = (mediaType: string, byteLength: number): Headers =>
  new Headers({
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "content-type": mediaType,
    "content-length": String(byteLength),
  });

export const handleProfilePhoto = Effect.gen(function* () {
  const auth = yield* Auth;
  const ns = yield* ChatNamespaces;
  const env: Readonly<Record<string, unknown>> = yield* Cloudflare.WorkerEnvironment;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
  const url = new URL(web.url);
  if (web.method !== "GET" && web.method !== "HEAD" && web.headers.get("origin") !== url.origin)
    return fail(403, "This request must come from the application origin.");
  const session = yield* auth.getSession();
  if (session === null) return fail(401, "Sign in to change your profile.");
  const catalog = ns.catalog(session.user.id);
  const scope = catalog.id.toString();
  const bucket = env.CHAT_FILES;
  if (!bucketBinding(bucket)) return fail(503, "Private avatar storage is not configured.");
  const seed = { "x-profile-seed": encodeURIComponent(session.user.name) };

  if (web.method === "POST") {
    const decoded = yield* Effect.promise(() => decodeAvatar(web));
    if (!decoded.ok)
      return HttpServerResponse.fromWeb(
        jsonResponse({ code: decoded.code, message: decoded.message }, decoded.status),
      );
    const avatarId = crypto.randomUUID();
    // Durable cleanup reservation before the object exists, so a failed or
    // uncertain put can never become an untracked orphan the sweep cannot see.
    const reserved = yield* doCall(catalog, "POST", "/profile/photo/reserve", { avatarId });
    if (reserved.status !== 200)
      return fail(503, "Avatar storage is unavailable. Your saved profile is unchanged.");
    const key = avatarObjectKey(scope, avatarId);
    const retire = doCall(
      catalog,
      "DELETE",
      `/profile/photo?id=${encodeURIComponent(avatarId)}`,
      undefined,
      seed,
    ).pipe(
      Effect.catch((cause) =>
        reportFailureEffect(cause, {
          component: "profile",
          operation: "avatar.retire",
          operationId: avatarId,
          event: "application.cleanup",
        }).pipe(Effect.as(null)),
      ),
    );
    const stored = yield* Effect.promise(() =>
      putAvatarObject(bucket, key, decoded.value.bytes, {
        mediaType: decoded.value.mediaType,
        digest: decoded.value.digest,
        avatarId,
      }),
    ).pipe(
      Effect.tapCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : reportFailureEffect(cause, {
              component: "profile",
              operation: "avatar.put",
              operationId: avatarId,
            }),
      ),
      Effect.as(true),
      Effect.catchDefect(() => Effect.succeed(false)),
    );
    if (!stored) {
      // The reservation is durable, so the sweep retries even if this fails.
      yield* retire;
      return fail(503, "Avatar storage is unavailable. Your saved profile is unchanged.");
    }
    const call = yield* doCall(catalog, "POST", "/profile/photo", {
      avatarId,
      mediaType: decoded.value.mediaType,
      width: decoded.value.width,
      height: decoded.value.height,
      byteSize: decoded.value.byteSize,
      digest: decoded.value.digest,
      stagedAt: Date.now(),
    });
    const avatar =
      call.status === 200 ? (decodeOption(AvatarUploadResponse, call.body)?.avatar ?? null) : null;
    if (avatar === null) {
      yield* reportFailureEffect(new Error("Private avatar staging was not acknowledged"), {
        component: "profile",
        operation: "avatar.stage",
        operationId: avatarId,
        status: call.status,
        event: call.status === 409 ? "application.denial" : "application.failure",
      });
      yield* retire;
      return fail(
        call.status === 409 ? 409 : 503,
        "That photo could not be acknowledged. Your saved profile is unchanged.",
      );
    }
    return HttpServerResponse.fromWeb(jsonResponse({ avatar }, 200));
  }

  if (web.method === "DELETE") {
    const avatarId = url.searchParams.get("id") ?? "";
    const call = yield* doCall(
      catalog,
      "DELETE",
      `/profile/photo?id=${encodeURIComponent(avatarId)}`,
      undefined,
      seed,
    );
    if (call.status === 200) return HttpServerResponse.fromWeb(jsonResponse({ ok: true }, 200));
    return fail(call.status === 410 ? 410 : 503, "That photo change is no longer staged.");
  }

  const call = yield* doCall(catalog, "GET", "/profile/photo", undefined, seed);
  if (call.status !== 200)
    throw Object.assign(new Error("Private avatar catalog read failed"), { status: call.status });
  const avatar = Schema.decodeUnknownSync(AvatarRefResponse)(call.body).avatar;
  if (avatar.kind !== "photo") return fail(404, "No profile photo is saved.");
  const stored = yield* Effect.promise(() =>
    readAvatar(bucket, avatarObjectKey(scope, avatar.avatarId)),
  );
  if (stored === null) return fail(404, "No profile photo is saved.");
  return HttpServerResponse.fromWeb(
    new Response(web.method === "HEAD" ? null : stored.bytes, {
      headers: avatarHeaders(stored.mediaType, stored.bytes.byteLength),
    }),
  );
}).pipe(
  Effect.provide(RuntimeContext.phantom),
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : reportFailureEffect(cause, { component: "profile", operation: "http.request" }),
  ),
  Effect.catch(() => Effect.succeed(fail(503, "Avatar service unavailable."))),
  Effect.catchDefect(() => Effect.succeed(fail(503, "Avatar service unavailable."))),
);
