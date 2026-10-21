/**
 * Stored manifest document decoding for the private skill library.
 *
 * Only the parent-owned schema shape is decoded here; owner-scope and digest
 * verification stay in `skills-store.ts` so no unverified manifest is trusted.
 */
import { Option, Schema } from "effect";
import { SkillManifest } from "./skills-model.ts";
import type { SkillStorage } from "./skills-rows.ts";

export const readSkillManifest = (
  storage: SkillStorage,
  revision: string,
): SkillManifest | null => {
  const row = storage.sql
    .exec<{ document: string }>(`SELECT document FROM skill_manifests WHERE revision = ?`, revision)
    .toArray()[0];
  if (row === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(row.document);
    return Option.getOrNull(Schema.decodeUnknownOption(SkillManifest)(parsed));
  } catch {
    return null;
  }
};
