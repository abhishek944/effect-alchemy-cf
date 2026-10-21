/**
 * Bounded queue of retained upload intents per user.
 *
 * Every distinct publication keeps its own id until an authoritative outcome
 * retires it, so an uncertain upload is never overwritten by the next choice.
 * Nothing secret is stored: id, filename, local digest, expected version and
 * the time the attempt started. One legacy single-record value migrates.
 */
import type { SkillCandidate } from "./skills-file";
import { isSkillId, skillFilenameProblem } from "./skills-validate";

export type SkillUploadIntent = {
  readonly uploadId: string;
  readonly filename: string;
  readonly digest: string;
  readonly replaceVersion: string | null;
  readonly startedAt: number;
};

export type SkillAttemptSave = "saved" | "full" | "unavailable";

export const MAX_UNRESOLVED_SKILL_UPLOADS = 4;

export const SKILL_STORAGE_MESSAGE =
  "Uploads need browser session storage to remember this attempt. Enable site storage and try again.";

const KEY_PREFIX = "skills-upload:v1:";
const DIGEST = /^[0-9a-f]{64}$/;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asIntent = (value: unknown): SkillUploadIntent | null => {
  if (!isRecord(value)) return null;
  const { uploadId, filename, digest, replaceVersion, startedAt } = value;
  if (!isSkillId(uploadId)) return null;
  if (typeof filename !== "string" || skillFilenameProblem(filename) !== null) return null;
  if (typeof digest !== "string" || !DIGEST.test(digest)) return null;
  if (replaceVersion !== null && !isSkillId(replaceVersion)) return null;
  return {
    uploadId,
    filename,
    digest,
    replaceVersion,
    startedAt: typeof startedAt === "number" && Number.isFinite(startedAt) ? startedAt : 0,
  };
};

const parseAttempts = (raw: string): SkillUploadIntent[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const entries = Array.isArray(parsed) ? (parsed as unknown[]) : [parsed];
  const seen = new Set<string>();
  const intents: SkillUploadIntent[] = [];
  for (const entry of entries) {
    const intent = asIntent(entry);
    if (intent === null || seen.has(intent.uploadId)) continue;
    seen.add(intent.uploadId);
    intents.push(intent);
  }
  return intents.slice(0, MAX_UNRESOLVED_SKILL_UPLOADS);
};

function readRaw(userId: string): string | null {
  const store = storage();
  if (store === null) return null;
  try {
    return store.getItem(`${KEY_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

/** Oldest first; storage is the authority for every async decision. */
export function readSkillAttempts(userId: string): SkillUploadIntent[] {
  const raw = readRaw(userId);
  return raw === null ? [] : parseAttempts(raw);
}

/** Appends one intent; an existing id is replaced, a full queue is not. */
export function saveSkillAttempt(userId: string, intent: SkillUploadIntent): SkillAttemptSave {
  const store = storage();
  if (store === null) return "unavailable";
  const intents = readSkillAttempts(userId);
  const index = intents.findIndex((entry) => entry.uploadId === intent.uploadId);
  if (index === -1 && intents.length >= MAX_UNRESOLVED_SKILL_UPLOADS) return "full";
  const next =
    index === -1
      ? [...intents, intent]
      : intents.map((entry, position) => (position === index ? intent : entry));
  const key = `${KEY_PREFIX}${userId}`;
  const value = JSON.stringify(next);
  try {
    store.setItem(key, value);
    return store.getItem(key) === value ? "saved" : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Compare-and-clear by exact id: a late callback can never erase a newer attempt. */
export function clearSkillAttempt(userId: string, uploadId: string): void {
  const store = storage();
  if (store === null) return;
  const intents = readSkillAttempts(userId);
  const next = intents.filter((entry) => entry.uploadId !== uploadId);
  if (next.length === intents.length) return;
  const key = `${KEY_PREFIX}${userId}`;
  try {
    if (next.length === 0) store.removeItem(key);
    else store.setItem(key, JSON.stringify(next));
  } catch {
    // The record expires with the tab either way.
  }
}

export const createSkillIntent = (
  candidate: SkillCandidate,
  replaceVersion: string | null,
): SkillUploadIntent => ({
  uploadId: crypto.randomUUID(),
  filename: candidate.filename,
  digest: candidate.digest,
  replaceVersion,
  startedAt: Date.now(),
});
