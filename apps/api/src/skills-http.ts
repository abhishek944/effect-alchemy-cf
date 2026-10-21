/**
 * Native HTTP route for the private skill library: list/receipt and authenticated
 * original download, plus the raw single-file upload delegated to its own module.
 *
 * The owner comes only from the authenticated session; internal calls bind that
 * owner explicitly. Mutations require the exact application origin. Downloads
 * are forced attachments with no-store/nosniff/sandbox headers and verified
 * complete bytes, so nothing renders on the application origin.
 */
import type * as cf from "@cloudflare/workers-types";
import { Auth } from "@starter/auth";
import * as Cloudflare from "alchemy/Cloudflare";
import { RuntimeContext } from "alchemy";
import { Effect } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { ChatNamespaces, doCall } from "./chat-bindings.ts";
import { decodeOption } from "./chat-internal.ts";
import { SkillId, SkillList, SkillUploadReceipt, SkillVersionRef } from "./skills-model.ts";
import { invalidSkill, internalFailure, jsonResponse, unavailable } from "./skills-http-shared.ts";
import { readSkillBytes } from "./skills-objects.ts";
import { uploadSkill } from "./skills-upload-http.ts";

export const isSkillsPath = (pathname: string): boolean =>
  pathname === "/api/skills" ||
  pathname === "/api/skills/download" ||
  pathname === "/api/skills/cancel";

const bucketBinding = (value: unknown): value is cf.R2Bucket =>
  typeof value === "object" &&
  value !== null &&
  "get" in value &&
  typeof value.get === "function" &&
  "put" in value &&
  typeof value.put === "function" &&
  "delete" in value &&
  typeof value.delete === "function";

const downloadResponse = (
  ref: SkillVersionRef,
  bytes: Uint8Array,
): HttpServerResponse.HttpServerResponse => {
  const safe = ref.filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "skill.txt";
  const encoded = encodeURIComponent(ref.filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return HttpServerResponse.fromWeb(
    new Response(bytes, {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "same-origin",
        "content-disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`,
        "content-type": "text/plain; charset=utf-8",
        "content-length": String(bytes.byteLength),
      },
    }),
  );
};

export const handleSkills = Effect.gen(function* () {
  const auth = yield* Auth;
  const ns = yield* ChatNamespaces;
  const env: Readonly<Record<string, unknown>> = yield* Cloudflare.WorkerEnvironment;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
  const url = new URL(web.url);
  const bucket = env.CHAT_FILES;
  if (web.method !== "GET" && web.headers.get("origin") !== url.origin)
    return unavailable("This request must come from the application origin.", 403);
  const session = yield* auth.getSession();
  if (session === null) return unavailable("Sign in to manage your skills.", 401);
  const catalog = ns.catalog(session.user.id);
  const scope = catalog.id.toString();
  const owner = { "x-chat-owner": session.user.id };

  if (url.pathname === "/api/skills/download") {
    if (web.method !== "GET") return invalidSkill("Download uses GET only.", 405);
    const id = decodeOption(SkillId, url.searchParams.get("id"));
    const version = decodeOption(SkillId, url.searchParams.get("version"));
    if (id === null || version === null)
      return invalidSkill("Provide a valid skill id and version.", 400);
    if (!bucketBinding(bucket)) return unavailable("Private skill storage is not configured.");
    const call = yield* doCall(
      catalog,
      "GET",
      `/skills/file?id=${encodeURIComponent(id)}&version=${encodeURIComponent(version)}`,
      undefined,
      owner,
    );
    if (call.status !== 200) return internalFailure(call, "That skill file is not available.");
    const ref = decodeOption(SkillVersionRef, call.body);
    if (ref === null || ref.id !== id || ref.version !== version)
      return unavailable("That skill file is not available.", 404);
    const bytes = yield* Effect.promise(async () => {
      try {
        return await readSkillBytes(bucket, scope, ref);
      } catch {
        return null;
      }
    });
    if (bytes === null) return unavailable("That skill file could not be verified.");
    return downloadResponse(ref, bytes);
  }

  if (url.pathname === "/api/skills/cancel") {
    if (web.method !== "POST") return invalidSkill("Cancellation uses POST only.", 405);
    const uploadId = decodeOption(SkillId, url.searchParams.get("uploadId"));
    if (uploadId === null) return invalidSkill("Provide a valid upload id.", 400);
    const call = yield* doCall(catalog, "POST", "/skills/cancel", { uploadId }, owner);
    if (call.status !== 200) return internalFailure(call, "The skill library is unavailable.");
    const receipt = decodeOption(SkillUploadReceipt, call.body);
    if (
      receipt === null ||
      receipt.uploadId !== uploadId ||
      (receipt.state !== "published" && receipt.state !== "expired")
    )
      return unavailable("The skill library returned an invalid cancellation.");
    return jsonResponse(receipt, 200);
  }

  if (url.pathname !== "/api/skills")
    return invalidSkill("That skills request is not supported.", 404);

  if (web.method === "GET") {
    const uploadId = url.searchParams.get("uploadId");
    if (uploadId !== null && decodeOption(SkillId, uploadId) === null)
      return invalidSkill("That upload id is not valid.", 400);
    const call = yield* doCall(
      catalog,
      "GET",
      `/skills${uploadId === null ? "" : `?uploadId=${encodeURIComponent(uploadId)}`}`,
      undefined,
      owner,
    );
    if (call.status !== 200) return internalFailure(call, "The skill library is unavailable.");
    const list = decodeOption(SkillList, call.body);
    return list === null
      ? unavailable("The skill library returned an invalid response.")
      : jsonResponse(list, 200);
  }

  if (web.method !== "POST") return invalidSkill("That skills method is not supported.", 405);
  if (!bucketBinding(bucket)) return unavailable("Private skill storage is not configured.");
  return yield* uploadSkill({ catalog, owner, scope, bucket, url, web });
}).pipe(
  Effect.provide(RuntimeContext.phantom),
  Effect.catch(() => Effect.succeed(unavailable("Skills service unavailable."))),
  Effect.catchDefect(() => Effect.succeed(unavailable("Skills service unavailable."))),
);
