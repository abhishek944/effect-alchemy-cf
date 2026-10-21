/**
 * Browser-side read of one selected instruction file.
 *
 * The same .txt/.md filename, 64 KiB, UTF-8 and plain-text rules are enforced
 * again by the server; this module exists so the picker can fail fast and the
 * retained digest identifies one stable publication intent. File contents are
 * never rendered, described or attached to a preview.
 */
import { MAX_SKILL_BYTES, skillFilenameProblem } from "./skills-validate";

export type SkillCandidate = {
  readonly filename: string;
  readonly digest: string;
  readonly byteSize: number;
};

export type SkillCandidateResult =
  | { readonly ok: true; readonly candidate: SkillCandidate }
  | { readonly ok: false; readonly message: string };

const readableControls = new Set([0x09, 0x0a, 0x0c, 0x0d]);

/** No body preview: the decoded text is only checked, never stored or shown. */
const isPlainText = (text: string): boolean => {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x7f || (code < 0x20 && !readableControls.has(code))) return false;
    if (code >= 0x80 && code <= 0x9f) return false;
  }
  return true;
};

const sha256 = async (buffer: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export async function readSkillCandidate(file: File): Promise<SkillCandidateResult> {
  const problem = skillFilenameProblem(file.name);
  if (problem !== null) return { ok: false, message: problem };
  if (file.size === 0) {
    return { ok: false, message: "That file is empty. Add instructions and try again." };
  }
  if (file.size > MAX_SKILL_BYTES) {
    return { ok: false, message: "Choose a .txt or .md file up to 64 KiB." };
  }
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return { ok: false, message: "That file could not be read. Choose it again." };
  }
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SKILL_BYTES) {
    return { ok: false, message: "That file changed while it was being read. Choose it again." };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, message: "That file is not valid UTF-8 text." };
  }
  if (text.trim().length === 0) return { ok: false, message: "That file has no instructions." };
  if (!isPlainText(text)) {
    return { ok: false, message: "That file contains characters that are not plain text." };
  }
  try {
    return {
      ok: true,
      candidate: { filename: file.name, digest: await sha256(buffer), byteSize: bytes.byteLength },
    };
  } catch {
    return { ok: false, message: "That file could not be checked. Choose it again." };
  }
}

/** Saves the authenticated original bytes without ever showing them inline. */
export function saveSkillDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
