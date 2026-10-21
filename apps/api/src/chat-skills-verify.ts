/**
 * Request-boundary verification of one persisted attempt.
 *
 * The pin scope, catalog text digest and every active entry's text digest are
 * rechecked against the values committed from verified immutable documents, so
 * altered or corrupted durable state fails closed instead of rendering.
 */
import {
  renderActiveEntries,
  renderSkillCatalog,
  textDigest,
  type SkillDocument,
} from "./chat-skills-document.ts";
import {
  SKILLS_INTEGRITY,
  SKILLS_PINNED_UNAVAILABLE,
  SkillRuntimeError,
} from "./chat-skills-errors.ts";
import { sdkActivationTexts } from "./chat-skills-extension.ts";
import { verifySkillManifest } from "./skills-manifest.ts";
import type { SkillAttemptRow } from "./chat-skills-store.ts";

export type VerifiedAttemptState = {
  readonly catalog: string | null;
  readonly active: string;
};

export type VerifyAttemptResult =
  | { readonly ok: true; readonly state: VerifiedAttemptState }
  | { readonly ok: false; readonly message: string };

export const verifyAttemptState = async (
  row: SkillAttemptRow,
  scope: string | null,
): Promise<VerifyAttemptResult> => {
  const failed = { ok: false as const, message: SKILLS_PINNED_UNAVAILABLE };
  if (row.corrupt || row.pin === null || scope === null || row.pin.ownerScope !== scope)
    return failed;
  // Re-prove the complete immutable manifest, not just its scope string.
  if (!(await verifySkillManifest(row.pin, scope))) return failed;
  if (row.catalog !== null) {
    if (row.catalogDigest === null) return failed;
    if ((await textDigest(row.catalog)) !== row.catalogDigest) return failed;
  }
  for (const entry of row.active) {
    if ((await textDigest(entry.text)) !== entry.textDigest) return failed;
    // Each active entry must bind to its exact pin ref, never an invented one.
    const ref = row.pin.files.find(
      (file) =>
        file.version === entry.version &&
        file.digest === entry.digest &&
        file.filename === entry.name,
    );
    if (ref === undefined) return failed;
  }
  let active: string;
  try {
    active = renderActiveEntries(row.active);
  } catch {
    return failed;
  }
  return { ok: true, state: { catalog: row.catalog, active } };
};

/**
 * Bind persisted active text to the actual SDK-formatted activation derived
 * from the exact verified documents, so a schema-valid but wrong/stale body is
 * rejected even when its stored digest was recomputed. No second formatter and
 * no additional storage reads.
 */
export const verifyPinnedAgainstDocuments = async (
  documents: readonly SkillDocument[],
  active: readonly { readonly name: string; readonly text: string }[],
  fingerprint: string,
  storedCatalog: string | null,
): Promise<string> => {
  const catalog = renderSkillCatalog(documents);
  if (storedCatalog !== null && storedCatalog !== catalog)
    throw new SkillRuntimeError("integrity", SKILLS_INTEGRITY);
  if (active.length === 0) return catalog;
  const formatted = await sdkActivationTexts(documents, fingerprint);
  for (const entry of active) {
    if (formatted.get(entry.name) !== entry.text)
      throw new SkillRuntimeError("integrity", SKILLS_INTEGRITY);
  }
  return catalog;
};
