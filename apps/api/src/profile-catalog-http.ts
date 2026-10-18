/**
 * Private owner-catalog routes for the saved profile.
 *
 * Reachable only through the authenticated Worker `doCall` boundary; no browser
 * owner id or object key is accepted here. Bytes live in the private bucket, so
 * this module moves metadata only and derives every key from the catalog object
 * id. Uploads reserve a durable row before the Worker writes bytes, become
 * publishable only when marked ready, and are claimed into a non-publishable
 * deleting state before any sweep deletion is awaited.
 */
import type * as cf from "@cloudflare/workers-types";
import { decodeOption, json, requestBody } from "./chat-internal.ts";
import { avatarObjectKey, deleteAvatarKeys } from "./profile-avatar.ts";
import { READY_MAX_AGE_MS, RESERVED_MAX_AGE_MS, type ProfileObjects } from "./profile-objects.ts";
import type { ProfileStore } from "./profile-store.ts";
import {
  AvatarIdBody,
  ExistingProfileResponse,
  profileView,
  ProfileWrite,
  StagedAvatar,
  type ProfileFailure,
} from "./profile-model.ts";

export type ProfileCatalogEnv = { CHAT_FILES?: cf.R2Bucket };

const statusFor = (code: ProfileFailure): number => {
  if (code === "revision_conflict") return 409;
  if (code === "avatar_missing") return 404;
  if (code === "unavailable") return 503;
  if (code === "file_too_large") return 413;
  if (code === "unsupported_type" || code === "invalid_content") return 415;
  return 400;
};

const failure = (code: ProfileFailure, message: string, status?: number): Response =>
  json({ code, message }, status ?? statusFor(code));

const seedName = (request: Request): string => {
  const raw = request.headers.get("x-profile-seed");
  if (raw === null) return "User";
  try {
    return decodeURIComponent(raw);
  } catch {
    return "User";
  }
};

/**
 * Bounded best-effort cleanup. Candidates are claimed in SQL before deletion and
 * rows are removed only after the delete succeeded, so a failed delete is retried
 * and a claim can never be published while its bytes are being removed.
 */
export const sweepProfileObjects = async (
  objects: ProfileObjects,
  bucket: cf.R2Bucket | undefined,
  scope: string,
  now: number,
): Promise<void> => {
  if (bucket === undefined) return;
  const claimed = objects.claimCleanup(now, READY_MAX_AGE_MS, RESERVED_MAX_AGE_MS);
  if (claimed.length === 0) return;
  const keys = claimed.map((avatarId) => avatarObjectKey(scope, avatarId));
  try {
    await deleteAvatarKeys(bucket, keys);
  } catch {
    return;
  }
  objects.confirmDeleted(claimed);
};

export async function profileCatalog(
  request: Request,
  store: ProfileStore,
  objects: ProfileObjects,
  env: ProfileCatalogEnv,
  scope: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  const now = Date.now();
  if (route === "GET /profile")
    return json({ profile: profileView(store.read(seedName(request))) });
  if (route === "GET /profile/existing") {
    const record = store.find();
    return json(
      decodeOption(ExistingProfileResponse, {
        profile: record === null ? null : profileView(record),
      }),
    );
  }
  if (route === "PATCH /profile") {
    const input = decodeOption(ProfileWrite, await requestBody(request));
    if (input === null) return failure("invalid_input", "That profile change is not valid.");
    const result = store.publish(input, now);
    if (!result.ok)
      return failure(
        result.code,
        result.code === "revision_conflict"
          ? "Profile changed in another tab. Your draft is kept. Review the latest saved profile before retrying."
          : "That profile change cannot be saved.",
      );
    await sweepProfileObjects(objects, env.CHAT_FILES, scope, now);
    return json({ profile: profileView(result.value.record) });
  }
  if (route === "POST /profile/photo/reserve") {
    const avatarId = decodeOption(AvatarIdBody, await requestBody(request));
    if (avatarId === null) return failure("invalid_input", "That photo could not be staged.");
    const result = objects.reserve(avatarId.avatarId, now);
    if (!result.ok) return failure(result.code, "That photo could not be staged.", 409);
    return json({ reserved: true });
  }
  if (route === "POST /profile/photo") {
    const input = decodeOption(StagedAvatar, await requestBody(request));
    if (input === null) return failure("invalid_input", "That photo could not be staged.");
    const result = objects.markReady({
      avatarId: input.avatarId,
      mediaType: input.mediaType,
      width: input.width,
      height: input.height,
      byteSize: input.byteSize,
      digest: input.digest,
      now,
    });
    if (!result.ok) return failure(result.code, "That photo could not be staged.", 409);
    return json({ avatar: result.value });
  }
  if (route === "DELETE /profile/photo") {
    const avatarId = url.searchParams.get("id") ?? "";
    if (!objects.cancel(avatarId, now))
      return failure("avatar_not_staged", "That photo change is no longer staged.", 410);
    await sweepProfileObjects(objects, env.CHAT_FILES, scope, now);
    return json({ ok: true });
  }
  if (route === "GET /profile/photo") {
    const record = store.read(seedName(request));
    return json({ avatar: record.avatar });
  }
  return null;
}
