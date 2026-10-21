import type { SkillManifest } from "./skills-model.ts";

/** Comparison only; public/download filenames retain the original spelling. */
export const skillFilenameKey = (filename: string): string =>
  filename.normalize("NFC").toLowerCase();

/** Callers derive scope from the real owner catalog, never a browser/model key. */
export const skillObjectKey = (ownerScope: string, version: string): string =>
  `skills/v1/${encodeURIComponent(ownerScope)}/${encodeURIComponent(version)}`;

export async function skillManifestDigest(
  manifest: Omit<SkillManifest, "digest">,
): Promise<string> {
  const files = manifest.files
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((file) => [file.id, file.filename, file.version, file.digest, file.byteSize]);
  const bytes = new TextEncoder().encode(
    JSON.stringify([manifest.ownerScope, manifest.revision, files]),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Schema decoding precedes this semantic/integrity check at every read boundary. */
export async function verifySkillManifest(
  manifest: SkillManifest,
  expectedOwnerScope: string,
): Promise<boolean> {
  if (manifest.ownerScope !== expectedOwnerScope) return false;
  if (manifest.revision === "0" && manifest.files.length !== 0) return false;
  const ids = new Set(manifest.files.map((file) => file.id));
  const names = new Set(manifest.files.map((file) => skillFilenameKey(file.filename)));
  const versions = new Set(manifest.files.map((file) => file.version));
  if ([ids, names, versions].some((values) => values.size !== manifest.files.length)) return false;
  return manifest.digest === (await skillManifestDigest(manifest));
}
