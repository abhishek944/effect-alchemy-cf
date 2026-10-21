/**
 * Private skill-object storage for the owner library.
 *
 * Keys come from the parent-owned manifest contract plus the real owner scope,
 * never from an uploaded filename or path. Every read verifies the complete
 * object: exact byte size, SHA-256 digest and valid UTF-8 text. Nothing here
 * truncates, repairs or substitutes bytes, so a failed check is a hard error.
 */
import type * as cf from "@cloudflare/workers-types";
import { skillObjectKey } from "./skills-manifest.ts";
import { MAX_SKILL_BYTES, type SkillVersionRef } from "./skills-model.ts";

export class SkillObjectUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillObjectUnavailable";
  }
}

export const skillDigest = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const decodeText = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new SkillObjectUnavailable("The skill file is not valid UTF-8 text.");
  }
};

/** Copied before `put` so R2 never receives a view into a larger buffer. */
const detach = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

/** Complete, digest-verified original bytes for one immutable skill version. */
export const readSkillBytes = async (
  bucket: cf.R2Bucket,
  ownerScope: string,
  ref: SkillVersionRef,
): Promise<Uint8Array> => {
  const object = await bucket.get(skillObjectKey(ownerScope, ref.version));
  if (object === null) throw new SkillObjectUnavailable("The skill file is missing.");
  if (object.size !== ref.byteSize || ref.byteSize > MAX_SKILL_BYTES)
    throw new SkillObjectUnavailable("The skill file size does not match its manifest.");
  const bytes = new Uint8Array(await object.bytes());
  if (bytes.byteLength !== ref.byteSize || bytes.byteLength > MAX_SKILL_BYTES)
    throw new SkillObjectUnavailable("The skill file is incomplete.");
  if ((await skillDigest(bytes)) !== ref.digest)
    throw new SkillObjectUnavailable("The skill file digest does not match its manifest.");
  decodeText(bytes);
  return bytes;
};

/**
 * Strict integrity reader for runtime instruction loading. It verifies the
 * complete object and returns the full UTF-8 text, never a truncated prefix.
 */
export const readSkillText = async (
  bucket: cf.R2Bucket,
  ownerScope: string,
  ref: SkillVersionRef,
): Promise<string> => decodeText(await readSkillBytes(bucket, ownerScope, ref));

/**
 * Writes one reserved version with a create-once PUT and verifies the stored
 * bytes before returning. `etagDoesNotMatch: "*"` makes R2 evaluate the write
 * atomically: a concurrent or replayed PUT can never replace existing bytes,
 * and a retirement marker permanently blocks resurrecting an expired version.
 * A null result means the key already exists, so the bytes are re-read and must
 * still match the reservation exactly; a marker or mismatch throws.
 */
export const putSkillObject = async (
  bucket: cf.R2Bucket,
  ownerScope: string,
  ref: SkillVersionRef,
  bytes: Uint8Array,
): Promise<void> => {
  if (
    bytes.byteLength !== ref.byteSize ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_SKILL_BYTES
  )
    throw new SkillObjectUnavailable("The skill file size is not valid.");
  if ((await skillDigest(bytes)) !== ref.digest)
    throw new SkillObjectUnavailable("The skill file digest is not valid.");
  await bucket.put(skillObjectKey(ownerScope, ref.version), detach(bytes), {
    httpMetadata: { contentType: "text/plain; charset=utf-8", cacheControl: "no-store" },
    customMetadata: {
      skillId: ref.id,
      filename: ref.filename,
      digest: ref.digest,
      byteSize: String(ref.byteSize),
    },
    onlyIf: { etagDoesNotMatch: "*" },
  });
  await readSkillBytes(bucket, ownerScope, ref);
};

/**
 * Replaces one claimed unpublished version with a permanent zero-byte marker.
 * The marker is an unconditional overwrite, so it wins over any already
 * committed late PUT, and the create-once PUT above can never overwrite it.
 * Callers release the original byte quota only after this resolves.
 */
export const retireSkillObject = async (
  bucket: cf.R2Bucket,
  ownerScope: string,
  version: string,
): Promise<void> => {
  await bucket.put(skillObjectKey(ownerScope, version), new Uint8Array(0), {
    httpMetadata: { contentType: "text/plain; charset=utf-8", cacheControl: "no-store" },
    customMetadata: { retired: "1" },
  });
};
