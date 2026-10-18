/**
 * Owner-scoped R2 layout for a private avatar.
 *
 * Keys are derived from the owner catalog object id plus a server-minted avatar
 * id, never from a browser value, and they never leave server code. Bytes are
 * written before the record can reference them; unreferenced, superseded and
 * cancelled objects are deleted explicitly and retried by the catalog sweep.
 */
import type * as cf from "@cloudflare/workers-types";
import type { AvatarMediaType } from "./profile-model.ts";

/** Owner prefix stays discoverable even after an expired reservation row is gone. */
export const avatarObjectPrefix = (scope: string): string => `profile-photo/${scope}/`;

/** One object key per uploaded avatar; activation happens in the profile record. */
export const avatarObjectKey = (scope: string, avatarId: string): string =>
  `${avatarObjectPrefix(scope)}${avatarId}`;

/** Copied before `put` so R2 never receives a view into a larger buffer. */
const detach = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

export const putAvatarObject = async (
  bucket: cf.R2Bucket,
  key: string,
  bytes: Uint8Array,
  metadata: {
    readonly mediaType: AvatarMediaType;
    readonly digest: string;
    readonly avatarId: string;
  },
): Promise<void> => {
  await bucket.put(key, detach(bytes), {
    httpMetadata: { contentType: metadata.mediaType, cacheControl: "no-store" },
    customMetadata: { avatarId: metadata.avatarId, digest: metadata.digest },
  });
};

export const readAvatar = async (
  bucket: cf.R2Bucket,
  key: string,
): Promise<{ readonly bytes: Uint8Array; readonly mediaType: string } | null> => {
  const object = await bucket.get(key);
  if (object === null) return null;
  return {
    bytes: await object.bytes(),
    mediaType: object.httpMetadata?.contentType ?? "application/octet-stream",
  };
};

/** Best-effort removal; a failure leaves the key recorded for the sweep. */
export const deleteAvatarKeys = async (
  bucket: cf.R2Bucket,
  keys: readonly string[],
): Promise<void> => {
  if (keys.length === 0) return;
  await bucket.delete([...keys]);
};
