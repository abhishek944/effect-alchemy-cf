/**
 * Side-effect-free owner readiness probe.
 *
 * Verifies the latest published manifest, its scope and digest, and whether a
 * nonempty library can actually read its private bytes. It never installs an
 * extension, never mutates a pin or an active run, and never reads skill bodies
 * (readiness must not cost a per-token or per-file fetch). An empty verified
 * library is ready without an object binding.
 */
import type * as cf from "@cloudflare/workers-types";
import { SKILLS_INTEGRITY, SKILLS_UNAVAILABLE } from "./chat-skills-errors.ts";
import { decodeOption } from "./chat-internal.ts";
import { verifySkillManifest } from "./skills-manifest.ts";
import { SkillManifest } from "./skills-model.ts";

export type SkillReadiness = {
  readonly ready: boolean;
  readonly message: string;
  readonly revision: string | null;
  readonly files: number;
};

const unavailable = (message: string): SkillReadiness => ({
  ready: false,
  message,
  revision: null,
  files: 0,
});

export const readSkillReadiness = async (
  source: { readonly catalog: cf.DurableObjectStub; readonly bucket: cf.R2Bucket | null } | null,
  ownerId: string | null,
): Promise<SkillReadiness> => {
  if (source === null || ownerId === null) return unavailable(SKILLS_UNAVAILABLE);
  let raw: unknown = null;
  try {
    const response = await source.catalog.fetch("https://chat.internal/skills/snapshot", {
      method: "GET",
      headers: { accept: "application/json", "x-chat-owner": ownerId },
    });
    if (response.status !== 200) return unavailable(SKILLS_UNAVAILABLE);
    raw = await response.json();
  } catch {
    return unavailable(SKILLS_UNAVAILABLE);
  }
  const value: unknown =
    typeof raw === "object" && raw !== null && "ok" in raw
      ? Reflect.get(raw, "ok") === true
        ? Reflect.get(raw, "value")
        : null
      : raw;
  const manifest = decodeOption(SkillManifest, value);
  if (manifest === null) return unavailable(SKILLS_INTEGRITY);
  if (!(await verifySkillManifest(manifest, source.catalog.id.toString())))
    return unavailable(SKILLS_INTEGRITY);
  if (manifest.files.length > 0 && source.bucket === null) return unavailable(SKILLS_UNAVAILABLE);
  return { ready: true, message: "", revision: manifest.revision, files: manifest.files.length };
};
