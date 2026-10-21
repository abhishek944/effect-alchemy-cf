/**
 * Validation for untrusted Skills wire data plus the browser mirror of the
 * server's filename rules. The server stays authoritative for bytes, UTF-8
 * and the final catalog state; this module only keeps the UI honest.
 */
import type {
  PublishedSkillUpload,
  SkillErrorBody,
  SkillErrorCode,
  SkillFile,
  SkillList,
  SkillUploadReceipt,
} from "./skills-types";

/** Mirrors the defensive server bound in apps/api/src/skills-model.ts. */
export const MAX_SKILL_BYTES = 64 * 1024;
export const MAX_SKILLS = 32;

const SKILL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKILL_REVISION = /^(?:0|(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))$/i;

/** All Unicode Cc the server pattern excludes, including C1 (U+0080..U+009F). */
const isControl = (code: number): boolean => code < 0x20 || (code >= 0x7f && code <= 0x9f);

const hasControlOrSlash = (text: string): boolean => {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (isControl(code)) return true;
    if (character === "/" || character === "\\") return true;
  }
  return false;
};

export const isSkillId = (value: unknown): value is string =>
  typeof value === "string" && SKILL_ID.test(value);

export const isSkillRevision = (value: unknown): value is string =>
  typeof value === "string" && SKILL_REVISION.test(value);

/** Comparison key only; the original spelling is preserved for display. */
export const skillFilenameKey = (filename: string): string =>
  filename.normalize("NFC").toLowerCase();

export function skillFilenameProblem(filename: string): string | null {
  if (filename.length < 4 || filename.length > 180) {
    return "Skill filenames must be 4 to 180 characters.";
  }
  const dot = filename.lastIndexOf(".");
  if (dot < 1) return "Upload a .txt or .md file.";
  const extension = filename.slice(dot + 1).toLowerCase();
  if (extension !== "txt" && extension !== "md") return "Upload a .txt or .md file.";
  const stem = filename.slice(0, dot);
  if (hasControlOrSlash(stem)) {
    return "Skill filenames cannot contain slashes or control characters.";
  }
  return null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

export function parseSkillFile(value: unknown): SkillFile | null {
  if (!isRecord(value)) return null;
  if (!isSkillId(value.id) || !isSkillId(value.version)) return null;
  if (typeof value.filename !== "string" || skillFilenameProblem(value.filename) !== null) {
    return null;
  }
  return { id: value.id, filename: value.filename, version: value.version };
}

function parseFiles(value: unknown): SkillFile[] | null {
  if (!Array.isArray(value) || value.length > MAX_SKILLS) return null;
  const files: SkillFile[] = [];
  for (const entry of value as unknown[]) {
    const file = parseSkillFile(entry);
    if (file === null) return null;
    files.push(file);
  }
  return files;
}

export function parseSkillReceipt(value: unknown): SkillUploadReceipt | null {
  if (!isRecord(value) || !isSkillId(value.uploadId)) return null;
  if (value.state === "pending" || value.state === "missing" || value.state === "expired") {
    return { uploadId: value.uploadId, state: value.state };
  }
  if (value.state !== "published" || !isSkillRevision(value.revision)) return null;
  const file = parseSkillFile(value.file);
  if (file === null) return null;
  return { uploadId: value.uploadId, state: "published", revision: value.revision, file };
}

export function parsePublishedSkillUpload(value: unknown): PublishedSkillUpload | null {
  const receipt = parseSkillReceipt(value);
  return receipt !== null && receipt.state === "published" ? receipt : null;
}

export function parseSkillList(value: unknown): SkillList | null {
  if (!isRecord(value) || !isSkillRevision(value.revision)) return null;
  const files = parseFiles(value.files);
  if (files === null) return null;
  if (value.receipt === null) return { revision: value.revision, files, receipt: null };
  const receipt = parseSkillReceipt(value.receipt);
  if (receipt === null) return null;
  return { revision: value.revision, files, receipt };
}

const isSkillErrorCode = (value: unknown): value is SkillErrorCode =>
  value === "invalid_skill" ||
  value === "skill_exists" ||
  value === "skill_conflict" ||
  value === "skill_limit" ||
  value === "skills_unavailable" ||
  value === "skill_upload_unknown";

export function parseSkillError(value: unknown): SkillErrorBody | null {
  if (!isRecord(value) || !isSkillErrorCode(value.code)) return null;
  if (!isText(value.message, 256)) return null;
  if (value.current === null) return { code: value.code, message: value.message, current: null };
  const current = parseSkillFile(value.current);
  if (current === null) return null;
  return { code: value.code, message: value.message, current };
}
