import { MAX_SKILL_BYTES } from "./skills-model.ts";
import { skillDigest } from "./skills-objects.ts";

export type SkillUploadValidation =
  | { readonly ok: true; readonly digest: string }
  | { readonly ok: false; readonly message: string };

/** Tab, newline, form feed and carriage return stay allowed; other C0/C1 controls do not. */
const hasControl = (text: string): boolean => {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 12 || code === 13) continue;
    if (code < 32 || (code >= 127 && code <= 159)) return true;
  }
  return false;
};

/**
 * Validates the raw upload body before anything is reserved or stored: bounded
 * bytes, complete fatal UTF-8, nonempty instruction text, no control payload.
 * Original bytes are preserved; only this check and the digest inspect them.
 */
export const validateSkillUpload = async (bytes: Uint8Array): Promise<SkillUploadValidation> => {
  if (bytes.byteLength === 0) return { ok: false, message: "Choose a nonempty .txt or .md file." };
  if (bytes.byteLength > MAX_SKILL_BYTES)
    return {
      ok: false,
      message: "That file is larger than 64 KiB. Choose a smaller .txt or .md file.",
    };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return { ok: false, message: "That file is not valid UTF-8 text." };
  }
  if (text.trim().length === 0) return { ok: false, message: "That file has no instruction text." };
  if (hasControl(text))
    return { ok: false, message: "That file contains unsupported control characters." };
  return { ok: true, digest: await skillDigest(bytes) };
};
